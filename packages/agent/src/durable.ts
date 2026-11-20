import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
    AssistantEntry,
    type Conversation,
    createRegistry,
    Harness,
    type LiveState,
    type SubmissionRecord,
    UsageDoc,
} from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createToolSearchExtension } from '@earendil-works/pi-durable/tool-search';
import { createCodingTools } from '@earendil-works/pi-durable/tools';
import type { AgentEvent } from '@sedge-hq/protocol';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentHost, RunContext } from './host';
import { type McpServerState, openMcp } from './mcp';
import { recallExtension } from './recall';
import { actionsExtension, searchTools, sedgeExtension, skillsExtension } from './tools';
import type { PiExtensions } from './pi-extensions';
import { type Sandbox, sandboxedEnv } from './sandbox';
import { type Triage, type TriageEvent, triage, triageModel } from './triage';

export interface ModelChoice {
    readonly provider: string;
    readonly modelId: string;
    readonly thinkingLevel?: ModelThinkingLevel;
}

export interface DurableOptions {
    /** The SQLite file conversations, runs and tool calls are kept in. */
    readonly file: string;
    /** Where runs work unless a run says otherwise. */
    readonly workspace: string;
    readonly models: Models;
    /** The model to use for a run in `cwd`: pi's default, read fresh each run. */
    readonly model: (cwd: string) => Promise<ModelChoice | undefined>;
    readonly host: AgentHost;
    readonly report: (message: string) => void;
    /** Your MCP servers: the mcp.json to read, and the version sedge introduces itself with. */
    readonly mcp?: { readonly file: string; readonly version: string };
    /** Your skills, as the prompt lists them, for a run in `cwd`. */
    readonly skills?: (cwd: string) => string | undefined;
    /** When set, commands run in the OS sandbox and file tools keep to its rules. */
    readonly sandbox?: Sandbox | undefined;
    /** The pi extensions listed for the daemon, loaded. */
    readonly piExtensions?: PiExtensions | undefined;
}

export interface Item {
    readonly id: string;
    readonly text: string;
}

/** Tokens and money a run (or a triage call) used. Cost is what the model's catalog lists. */
export interface Spent {
    readonly tokens: number;
    readonly cost: number;
}

export interface RunRequest extends RunContext {
    readonly items: ReadonlyArray<Item>;
    /** Told what the run used once it ends, whether it answered or failed. */
    readonly onSpent?: ((spent: Spent) => void) | undefined;
    /** A subagent's run: its conversation starts without sedge's actions (messages, timers…). */
    readonly subagent?: boolean | undefined;
}

const MAIN = 'main';

/**
 * The daemon's agent, on pi-durable. Each thread is a durable conversation ("main" is the root
 * one), so a run that a crash or restart cuts short picks up where it stopped, and an event that
 * arrives twice is answered once: every inbox item is submitted with its id as the request id.
 * Events that queue up while the agent works are answered together in its next run.
 */
export type Durable = Awaited<ReturnType<typeof openDurable>>;

export const openDurable = async (options: DurableOptions) => {
    // thread → conversation id, and back. Root is "main"; the others are created on first use.
    const mapFile = `${options.file}.threads.json`;
    const threads = new Map<string, number>(
        Object.entries(
            JSON.parse(await readFile(mapFile, 'utf8').catch(() => '{}')) as Record<string, number>,
        ),
    );
    const saveThreads = async () => {
        const temp = `${mapFile}.tmp`;
        await writeFile(temp, JSON.stringify(Object.fromEntries(threads)));
        await rename(temp, mapFile);
    };
    const threadOf = (id: number) =>
        [...threads.entries()].find(([, value]) => value === id)?.[0] ?? MAIN;

    // What each conversation's current run is about. A run the harness resumes after a restart has
    // no entry: it counts as unattended, the safe assumption.
    const runs = new Map<string, RunContext>();
    const runFor = (conversationId: number): RunContext => {
        const thread = threadOf(conversationId);
        // A run a restart resumes: what woke it isn't known here, so it gets the stricter rules.
        return (
            runs.get(thread) ?? {
                thread,
                sources: ['resumed'],
                cwd: options.workspace,
                untrusted: true,
            }
        );
    };

    const registry = createRegistry();
    registry.install(createCodingTools());
    registry.install(searchTools(options.sandbox?.isHidden));
    registry.install(sedgeExtension(options.host, runFor));
    const actions = actionsExtension(options.host, runFor);
    registry.install(actions);
    registry.install(createToolSearchExtension());
    if (options.piExtensions) {
        registry.install(options.piExtensions.extension);
        options.report(`pi extensions: ${options.piExtensions.names.join(', ')}`);
    }
    if (options.skills) {
        const skills = options.skills;
        registry.install(skillsExtension((id) => skills(runFor(id).cwd)));
    }

    await mkdir(dirname(options.file), { recursive: true });
    const storage = await openNodeSqliteStorage(options.file);
    const harness = await Harness.open(
        storage,
        {
            models: options.models,
            registry,
            env: ({ cwd }) => {
                const local = new NodeExecutionEnv({ cwd: cwd ?? options.workspace });
                return options.sandbox
                    ? sandboxedEnv(local, options.sandbox.forRun(local.cwd))
                    : local;
            },
            settings: { followUpMode: 'all', steeringMode: 'all', afterFailedRun: 'withdraw' },
            onReport: (report) =>
                options.report(
                    `${report.kind}: ${report.error instanceof Error ? report.error.message : JSON.stringify(report.error)}`,
                ),
        },
        ctx,
    );
    harness.resume();
    await options.piExtensions
        ?.start()
        .catch((error: unknown) =>
            options.report(
                `pi extensions: ${error instanceof Error ? error.message : String(error)}`,
            ),
        );
    threads.set(MAIN, (await harness.root(ctx)).id as number);
    registry.install(
        recallExtension({
            threads: () => [...threads.entries()],
            conversation: (id) => harness.conversation(id as never, ctx),
        }),
    );

    // MCP servers connect in the background; their tools join the registry when they are up, so a
    // slow server never holds up a run.
    let mcpStates: ReadonlyArray<McpServerState> = [];
    const mcp = options.mcp
        ? openMcp({ ...options.mcp, cwd: options.workspace }).then(
              (servers) => {
                  registry.install(servers.extension);
                  mcpStates = servers.states;
                  for (const state of servers.states)
                      options.report(`mcp ${state.name}: ${state.status}`);
                  return servers;
              },
              (error: unknown) => {
                  options.report(`mcp: ${error instanceof Error ? error.message : String(error)}`);
                  return undefined;
              },
          )
        : Promise.resolve(undefined);

    const conversationFor = async (thread: string, subagent: boolean): Promise<Conversation> => {
        if (thread === MAIN) {
            const root = await harness.root(ctx);
            threads.set(MAIN, root.id as number);
            return root;
        }
        const known = threads.get(thread);
        const existing =
            known === undefined ? undefined : await harness.conversation(known as never, ctx);
        if (existing) return existing;
        const created = await harness.createConversation(
            {
                ownership: { kind: 'ownerless' },
                ...(subagent ? { agent: { extensions: { remove: [actions] } } } : {}),
            },
            ctx,
        );
        threads.set(thread, created.id as number);
        await saveThreads();
        return created;
    };

    // Model and working directory follow pi's settings and the run; only changes are written.
    const prepare = async (conversation: Conversation, cwd: string) => {
        const choice = await options.model(cwd);
        if (!choice) throw new Error('No model is set up. Run `sedge` and log in with /login.');
        const agent = await conversation.agent(ctx);
        const change = {
            ...(agent.model?.provider !== choice.provider || agent.model?.modelId !== choice.modelId
                ? { model: { provider: choice.provider, modelId: choice.modelId } }
                : {}),
            ...(choice.thinkingLevel && agent.thinkingLevel !== choice.thinkingLevel
                ? { thinkingLevel: choice.thinkingLevel }
                : {}),
            ...(agent.cwd !== cwd ? { cwd } : {}),
        };
        if (Object.keys(change).length > 0) await conversation.configure(change, ctx);
    };

    const active = new Map<string, Conversation>();

    /** A conversation's running totals, over every model it used. */
    const spentSoFar = async (conversation: Conversation): Promise<Spent> => {
        const usage = await harness.snapshot(UsageDoc, conversation.id, ctx);
        let tokens = 0;
        let cost = 0;
        for (const model of Object.values(usage?.models ?? {})) {
            const counted = model as { totalTokens?: number; cost?: { total?: number } };
            tokens += counted.totalTokens ?? 0;
            cost += counted.cost?.total ?? 0;
        }
        return { tokens, cost };
    };

    const run = async (
        input: RunRequest,
        onEvent: (event: AgentEvent) => void,
    ): Promise<string> => {
        // The first run after a start waits a little for MCP servers, so their tools are there.
        await Promise.race([mcp, new Promise((done) => setTimeout(done, 10_000).unref())]);
        const conversation = await conversationFor(input.thread, input.subagent ?? false);
        await prepare(conversation, input.cwd);
        runs.set(input.thread, {
            thread: input.thread,
            sources: input.sources,
            cwd: input.cwd,
            untrusted: input.untrusted ?? false,
        });
        active.set(input.thread, conversation);
        // One run per conversation at a time, so the change in its totals is this run's own.
        const before = await spentSoFar(conversation);

        // The live document carries the answer as it streams and each tool call's state.
        let shown = '';
        let thought = '';
        const tools = new Map<string, string>();
        const watch = await conversation.watch(ctx);
        watch.start(async (call) => {
            if (call.kind !== 'value') return;
            const live = call.value.docs['pi.live'] as LiveState | undefined;
            const content = (live?.generation?.message?.content ?? []) as ReadonlyArray<{
                type: string;
                text?: string;
                thinking?: string;
            }>;
            const said = content.map((part) => part.text ?? '').join('');
            const thinking = content.map((part) => part.thinking ?? '').join('');
            if (said !== shown) {
                const delta = said.startsWith(shown) ? said.slice(shown.length) : said;
                if (delta) onEvent({ _tag: 'TextDelta', delta });
                shown = said;
            }
            if (thinking !== thought) {
                const delta = thinking.startsWith(thought)
                    ? thinking.slice(thought.length)
                    : thinking;
                if (delta) onEvent({ _tag: 'ThinkingDelta', delta });
                thought = thinking;
            }
            for (const slot of live?.tools ?? []) {
                const before = tools.get(slot.callId);
                if (before === slot.status) continue;
                tools.set(slot.callId, slot.status);
                if (!before && slot.status !== 'pending') {
                    onEvent({ _tag: 'ToolStart', toolCallId: slot.callId, name: slot.name });
                }
                if (slot.status === 'done') {
                    onEvent({
                        _tag: 'ToolEnd',
                        toolCallId: slot.callId,
                        name: slot.name,
                        isError: slot.diagnostics?.some((d) => d.severity === 'error') ?? false,
                    });
                }
            }
        });

        try {
            const submissions = [];
            for (const item of input.items) {
                submissions.push(
                    await conversation.submit(
                        { type: 'input', content: item.text, requestId: item.id },
                        ctx,
                    ),
                );
            }
            const settled = await Promise.all(submissions.map((s) => s.wait(ctx)));
            const last = settled[settled.length - 1]!;
            if (last.status !== 'done' || last.answer === undefined) throw new Error(failure(last));
            const answer = last.answer;
            const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, answer), ctx);
            return (entry?.model ?? [])
                .flatMap((message) =>
                    message.role === 'assistant'
                        ? message.content.flatMap((part) =>
                              part.type === 'text' ? [part.text] : [],
                          )
                        : [],
                )
                .join('')
                .trim();
        } finally {
            await watch.stop();
            runs.delete(input.thread);
            active.delete(input.thread);
            if (input.onSpent) {
                const after = await spentSoFar(conversation).catch(() => before);
                input.onSpent({
                    tokens: Math.max(0, after.tokens - before.tokens),
                    cost: Math.max(0, after.cost - before.cost),
                });
            }
        }
    };

    /** One cheap call: do these events need the agent? Without a model, they do. */
    const triageEvents = async (
        events: ReadonlyArray<TriageEvent>,
        override?: string,
    ): Promise<Triage> => {
        const model = await triageModel(
            options.models,
            await options.model(options.workspace),
            override,
        );
        if (!model) return { wake: true, reason: 'no model to triage with' };
        return triage(options.models, model, events);
    };

    return {
        run,
        triage: triageEvents,
        abort: async () => {
            await Promise.all([...active.values()].map((conversation) => conversation.abort(ctx)));
        },
        /** How each MCP server is doing, once they have connected. */
        mcp: async () => {
            await mcp;
            return mcpStates;
        },
        close: async () => {
            await options.piExtensions?.close().catch(() => undefined);
            await (await mcp)?.close();
            await harness.close(ctx);
        },
    };
};

const failure = (record: SubmissionRecord) => {
    const { reason, detail } = record as { reason?: string; detail?: string };
    if (reason === 'aborted') return 'Stopped.';
    return detail ? `${reason ?? 'failed'}: ${detail}` : (reason ?? 'The run failed.');
};

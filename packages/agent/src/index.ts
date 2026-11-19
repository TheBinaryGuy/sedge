import type * as PiModule from '@earendil-works/pi-coding-agent';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { AgentRunError, type AgentEvent } from '@sedge-hq/protocol';
import { alwaysOnExtension } from './extension';
import type { AgentHost, RunContext } from './host';

export type { AgentHost, RunContext, TimerSpec, ToolDecision } from './host';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

type Pi = typeof PiModule;

export interface AgentConfig {
    /** pi's agent directory (auth.json, models.json, settings); pi's own default when unset. */
    readonly agentDir?: string | undefined;
    /** Where Sedge keeps its own conversations, apart from the ones you have with `pi`. */
    readonly sessionsDir: string;
    /**
     * Loads pi on the first run rather than at startup, so the daemon's socket is up in a fraction
     * of the time. The CLI passes one that runs pi's Bun setup first.
     */
    readonly loadPi: () => Promise<Pi>;
    /** Memory, outbox, timers and permissions, provided by the daemon. */
    readonly host: AgentHost;
}

export const defaultAgentConfig = (
    home: string,
    host: AgentHost,
    loadPi: () => Promise<Pi> = () => import('@earendil-works/pi-coding-agent'),
): AgentConfig => ({
    agentDir: process.env.SEDGE_AGENT_DIR,
    sessionsDir: join(home, 'sessions'),
    loadPi,
    host,
});

export interface RunInput extends RunContext {
    readonly prompt: string;
}

/**
 * pi does the reasoning; this service decides which conversation a run belongs to (one per
 * working directory, continued across daemon restarts) and translates pi's events into the
 * protocol's. Runs are serialized: the daemon's worker already sends one at a time, the lock
 * makes that a guarantee rather than a convention.
 */
export class Agent extends Context.Service<
    Agent,
    {
        readonly run: (
            input: RunInput,
            onEvent: (event: AgentEvent) => Effect.Effect<void>,
        ) => Effect.Effect<string, AgentRunError>;
        readonly abort: Effect.Effect<void>;
    }
>()('sedge/agent/Agent') {
    static readonly layer = (config: AgentConfig) =>
        Layer.effect(
            Agent,
            Effect.gen(function* () {
                const sessions = new Map<string, AgentSession>();
                const lock = yield* Semaphore.make(1);
                let active: AgentSession | undefined;
                // The run in progress, read by the always-on extension's tools and hooks.
                let current: RunContext | undefined;

                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        for (const session of sessions.values()) session.dispose();
                        sessions.clear();
                    }),
                );

                // One pi session per thread: a Telegram chat keeps its conversation across runs and
                // daemon restarts, and never shares one with a terminal task.
                const sessionFor = (thread: string, cwd: string) =>
                    Effect.tryPromise({
                        try: async () => {
                            const existing = sessions.get(thread);
                            if (existing) return existing;
                            const pi = await config.loadPi();
                            const agentDir = config.agentDir ?? pi.getAgentDir();
                            // Same extensions the pi CLI loads: MCP servers from mcp.json
                            // (yours in the agent dir, the project's once trusted), plus the
                            // codemode and tool_search tools MCP uses for large tool sets.
                            const resourceLoader = new pi.DefaultResourceLoader({
                                cwd,
                                agentDir,
                                extensionFactories: [
                                    pi.createCodemodeExtension({ mode: 'on' }),
                                    pi.createToolSearchExtension(),
                                    pi.createMcpExtension(),
                                    {
                                        name: 'sedge',
                                        factory: alwaysOnExtension(config.host, () => current),
                                    },
                                ],
                            });
                            await resourceLoader.reload();
                            const settingsManager = pi.SettingsManager.create(cwd, agentDir);
                            const { session } = await pi.createAgentSession({
                                cwd,
                                agentDir,
                                resourceLoader,
                                settingsManager,
                                sessionManager: pi.SessionManager.continueRecent(
                                    cwd,
                                    sessionDirFor(config.sessionsDir, thread),
                                ),
                            });
                            // Emits session_start, which connects MCP servers in the background.
                            await session.bindExtensions({});
                            sessions.set(thread, session);
                            return session;
                        },
                        catch: (cause) =>
                            new AgentRunError({
                                message: `Could not start pi: ${describe(cause)}`,
                            }),
                    });

                const run = Effect.fn('Agent.run')(function* (
                    input: RunInput,
                    onEvent: (event: AgentEvent) => Effect.Effect<void>,
                ) {
                    const session = yield* sessionFor(input.thread, input.cwd);
                    const services = yield* Effect.context<never>();
                    const emit = (event: AgentEvent) =>
                        Effect.runForkWith(services)(onEvent(event));

                    const unsubscribe = session.subscribe((event) => {
                        const mapped = toProtocolEvent(event);
                        if (mapped) emit(mapped);
                    });

                    return yield* Effect.tryPromise({
                        try: async () => {
                            active = session;
                            current = {
                                thread: input.thread,
                                sources: input.sources,
                                cwd: input.cwd,
                            };
                            await session.prompt(input.prompt);
                            return session.getLastAssistantText() ?? '';
                        },
                        catch: (cause) => new AgentRunError({ message: describe(cause) }),
                    }).pipe(
                        Effect.ensuring(
                            Effect.sync(() => {
                                active = undefined;
                                current = undefined;
                                unsubscribe();
                            }),
                        ),
                    );
                }, lock.withPermits(1));

                const abort = Effect.promise(async () => {
                    await active?.abort();
                });

                return Agent.of({ run, abort });
            }),
        );
}

const toProtocolEvent = (event: AgentSessionEvent): AgentEvent | undefined => {
    switch (event.type) {
        case 'message_update': {
            const inner = event.assistantMessageEvent;
            if (inner.type === 'text_delta') return { _tag: 'TextDelta', delta: inner.delta };
            if (inner.type === 'thinking_delta')
                return { _tag: 'ThinkingDelta', delta: inner.delta };
            return undefined;
        }
        case 'tool_execution_start':
            return { _tag: 'ToolStart', toolCallId: event.toolCallId, name: event.toolName };
        case 'tool_execution_end':
            return {
                _tag: 'ToolEnd',
                toolCallId: event.toolCallId,
                name: event.toolName,
                isError: event.isError,
            };
        default:
            return undefined;
    }
};

/** A readable, collision-free directory name per thread (`telegram_12345-1a2b3c4d`). */
const sessionDirFor = (root: string, thread: string) =>
    join(
        root,
        `${
            basename(thread)
                .replace(/[^\w.-]/g, '_')
                .slice(-40) || 'thread'
        }-${createHash('sha256').update(thread).digest('hex').slice(0, 8)}`,
    );

const describe = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause);

import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createMcpToolName } from '@earendil-works/pi-mcp';
import { Effect, ManagedRuntime } from 'effect';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentHost, Outgoing } from './host';
import { Agent } from './index';

interface Extras {
    readonly skills?: (cwd: string) => string | undefined;
    readonly mcp?: { readonly file: string; readonly version: string };
}

const setup = async (extras: (dir: string) => Promise<Extras> = async () => ({})) => {
    const dir = await mkdtemp(join(tmpdir(), 'sedge-agent-test-'));
    const faux = fauxProvider({ tokensPerSecond: 1000 });
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const sent: Array<Outgoing> = [];
    const told: Array<{ from: string; agent: string; message: string }> = [];
    const started: Array<{ from: string; task: string; key: string }> = [];
    const blocked: Array<string> = [];
    const checked: Array<string> = [];
    const more = await extras(dir);
    const host: AgentHost = {
        systemPrompt: async () => 'You are sedge.',
        send: async (_run, message) => {
            sent.push(message);
            return 'Queued for delivery.';
        },
        tell: async (run, agent, message) => {
            told.push({ from: run.thread, agent, message });
            return 'Sent.';
        },
        subagent: async (run, task, key) => {
            started.push({ from: run.thread, task, key });
            return `Subagent ${started.length} started.`;
        },
        getState: async () => 'No named values.',
        setState: async () => 'set',
        setTimer: async () => 'set',
        listTimers: async () => 'none',
        cancelTimer: async () => false,
        checkTool: async (_run, name) => {
            checked.push(name);
            if (name !== 'bash') return { allow: true };
            blocked.push(name);
            return { allow: false, reason: 'This call needs the user’s approval.' };
        },
    };
    const open = () =>
        ManagedRuntime.make(
            Agent.layer({
                file: join(dir, 'durable.sqlite'),
                workspace: dir,
                loadPi: () => Promise.reject(new Error('pi is not used here')),
                host,
                models: async () => ({
                    models,
                    choose: async () => ({ provider: model.provider, modelId: model.id }),
                    ...more,
                }),
            }),
        );
    const run = (runtime: ReturnType<typeof open>, items: Array<{ id: string; text: string }>) =>
        runtime.runPromise(
            Effect.gen(function* () {
                const agent = yield* Agent;
                return yield* agent.run(
                    { thread: 'main', sources: ['telegram'], cwd: dir, items },
                    () => Effect.void,
                );
            }),
        );
    const runIn = (
        runtime: ReturnType<typeof open>,
        thread: string,
        items: Array<{ id: string; text: string }>,
        subagent = false,
    ) =>
        runtime.runPromise(
            Effect.gen(function* () {
                const agent = yield* Agent;
                return yield* agent.run(
                    { thread, sources: ['telegram'], cwd: dir, items, subagent },
                    () => Effect.void,
                );
            }),
        );
    return { dir, faux, sent, told, started, blocked, checked, open, run, runIn };
};

describe('the durable agent', () => {
    it('answers an event once, even when it arrives again after a restart', async () => {
        const { faux, open, run } = await setup();
        faux.setResponses([fauxAssistantMessage('hello there')]);
        const first = open();
        expect(await run(first, [{ id: 'event-1', text: 'hi' }])).toBe('hello there');
        await first.dispose();

        // No responses are left: a second model call would fail the run.
        const second = open();
        expect(await run(second, [{ id: 'event-1', text: 'hi' }])).toBe('hello there');
        await second.dispose();
    }, 30_000);

    it('keeps a blocked tool call from running, and delivers choices to the user', async () => {
        const { dir, faux, sent, blocked, open, run } = await setup();
        const marker = join(dir, 'ran');
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall('bash', { command: `touch ${marker}` })], {
                stopReason: 'toolUse',
            }),
            fauxAssistantMessage(
                [
                    fauxToolCall('send_message', {
                        text: 'May I run it?',
                        choices: [{ label: 'Yes', value: 'yes' }],
                    }),
                ],
                { stopReason: 'toolUse' },
            ),
            fauxAssistantMessage('Asked.'),
        ]);
        const runtime = open();
        expect(await run(runtime, [{ id: 'event-2', text: 'touch the file' }])).toBe('Asked.');
        await runtime.dispose();
        expect(blocked).toEqual(['bash']);
        expect(existsSync(marker)).toBe(false);
        expect(sent).toEqual([
            { text: 'May I run it?', choices: [{ label: 'Yes', value: 'yes' }] },
        ]);
    }, 30_000);

    it('finds an MCP server’s tool with tool_search and calls it, through the approval check', async () => {
        const log = join(await mkdtemp(join(tmpdir(), 'sedge-mcp-')), 'calls');
        process.env.SEDGE_TEST_MCP_LOG = log;
        const { faux, checked, open, run } = await setup(async (dir) => {
            const file = join(dir, 'mcp.json');
            await writeFile(
                file,
                JSON.stringify({
                    mcpServers: {
                        weather: {
                            command: process.execPath,
                            args: [join(import.meta.dirname, 'testing/fake-mcp.ts')],
                            env: { FAKE_MCP_LOG: '${SEDGE_TEST_MCP_LOG}' },
                        },
                        broken: { command: '/nonexistent/mcp-server' },
                    },
                }),
            );
            return { mcp: { file, version: 'test' } };
        });
        const tool = createMcpToolName('weather', 'get_weather');
        const seen: Array<string> = [];
        faux.setResponses([
            (context) => {
                seen.push(JSON.stringify(context));
                return fauxAssistantMessage(
                    [fauxToolCall('tool_search', { query: 'weather forecast' })],
                    {
                        stopReason: 'toolUse',
                    },
                );
            },
            (context) => {
                seen.push(JSON.stringify(context));
                return fauxAssistantMessage([fauxToolCall(tool, { city: 'Lisbon' })], {
                    stopReason: 'toolUse',
                });
            },
            (context) => {
                const result = context.messages.findLast((m) => m.role === 'toolResult');
                const text = result?.content
                    .map((part) => (part.type === 'text' ? part.text : ''))
                    .join('');
                return fauxAssistantMessage(text ?? 'no result');
            },
        ]);
        const runtime = open();
        const answer = await run(runtime, [{ id: 'event-3', text: 'weather in Lisbon?' }]);
        await runtime.dispose();
        // Deferred: not offered until tool_search found it.
        expect(seen[0]).toContain('tool_search');
        expect(seen[0]).not.toContain(`"${tool}"`);
        expect(seen[1]).toContain(tool);
        expect(answer).toBe('Sunny in Lisbon');
        expect(await readFile(log, 'utf8')).toBe('Lisbon\n');
        expect(checked).toContain(tool);
    }, 30_000);

    it('lists your skills in the system prompt', async () => {
        const { faux, open, run } = await setup(async () => ({
            skills: () =>
                '<available_skills><skill><name>deploy-preview</name></skill></available_skills>',
        }));
        faux.setResponses([
            (context) =>
                fauxAssistantMessage(
                    JSON.stringify(context).includes('deploy-preview') ? 'listed' : 'missing',
                ),
        ]);
        const runtime = open();
        expect(await run(runtime, [{ id: 'event-4', text: 'what can you do?' }])).toBe('listed');
        await runtime.dispose();
    }, 30_000);

    it('recalls what was said in an earlier conversation', async () => {
        const { faux, open, run } = await setup();
        faux.setResponses([
            fauxAssistantMessage('Noted.'),
            fauxAssistantMessage([fauxToolCall('recall', { query: 'dog' })], {
                stopReason: 'toolUse',
            }),
            (context) => {
                const result = context.messages.findLast((m) => m.role === 'toolResult');
                return fauxAssistantMessage(
                    result?.content
                        .map((part) => (part.type === 'text' ? part.text : ''))
                        .join('') ?? '',
                );
            },
        ]);
        const runtime = open();
        await run(runtime, [{ id: 'event-5', text: 'My dog is called Biscuit.' }]);
        const answer = await run(runtime, [{ id: 'event-6', text: 'What is my dog called?' }]);
        await runtime.dispose();
        expect(answer).toContain('My dog is called Biscuit.');
        expect(answer).toContain('[main ·');
    }, 30_000);

    it('has every tool documented in docs/commands.md', async () => {
        const { faux, open, run } = await setup();
        let tools: Array<string> = [];
        faux.setResponses([
            (context) => {
                tools = [
                    ...JSON.stringify(context).matchAll(/"name":"([a-z_]+)","description"/g),
                ].map((m) => m[1]!);
                return fauxAssistantMessage('ok');
            },
        ]);
        const runtime = open();
        await run(runtime, [{ id: 'event-7', text: 'hi' }]);
        await runtime.dispose();
        const page = await readFile(join(import.meta.dirname, '../../../docs/commands.md'), 'utf8');
        expect(tools.length).toBeGreaterThan(8);
        for (const tool of tools) expect(page, tool).toContain(`\`${tool}\``);
    }, 30_000);

    it('runs two agents at the same time, each in its own conversation', async () => {
        const { faux, open, runIn } = await setup();
        let reached: () => void = () => {};
        const bReached = new Promise<void>((resolve) => (reached = resolve));
        const lastUser = (context: {
            messages: ReadonlyArray<{ role: string; content: unknown }>;
        }) => JSON.stringify(context.messages.findLast((m) => m.role === 'user')?.content);
        const respond = async (
            context: Parameters<
                Extract<Parameters<typeof faux.setResponses>[0][number], Function>
            >[0],
        ) => {
            // A waits until B's run has started: if runs took turns, this would never finish.
            if (lastUser(context).includes('for A')) {
                await Promise.race([
                    bReached,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('B never started')), 5000),
                    ),
                ]);
                return fauxAssistantMessage('A done');
            }
            reached();
            return fauxAssistantMessage('B done');
        };
        faux.setResponses([respond, respond]);
        const runtime = open();
        const [a, b] = await Promise.all([
            runIn(runtime, 'main', [{ id: 'event-a', text: 'for A' }]),
            runIn(runtime, 'agent:ci', [{ id: 'event-b', text: 'for B' }]),
        ]);
        await runtime.dispose();
        expect([a, b]).toEqual(['A done', 'B done']);
    }, 30_000);

    it('tells another agent through the host', async () => {
        const { faux, told, open, runIn } = await setup();
        faux.setResponses([
            fauxAssistantMessage(
                [fauxToolCall('tell', { agent: 'main', message: 'CI is red on main' })],
                {
                    stopReason: 'toolUse',
                },
            ),
            fauxAssistantMessage('Told main.'),
        ]);
        const runtime = open();
        expect(
            await runIn(runtime, 'agent:ci', [{ id: 'event-8', text: 'the build failed' }]),
        ).toBe('Told main.');
        await runtime.dispose();
        expect(told).toEqual([{ from: 'agent:ci', agent: 'main', message: 'CI is red on main' }]);
    }, 30_000);

    it('starts several subagents in one turn, each once', async () => {
        const { faux, started, open, run } = await setup();
        faux.setResponses([
            fauxAssistantMessage(
                [
                    fauxToolCall('subagent', { task: 'Check repo a.' }),
                    fauxToolCall('subagent', { task: 'Check repo b.' }),
                ],
                { stopReason: 'toolUse' },
            ),
            fauxAssistantMessage('Started both.'),
        ]);
        const runtime = open();
        expect(await run(runtime, [{ id: 'event-9', text: 'check both repos' }])).toBe(
            'Started both.',
        );
        await runtime.dispose();
        expect(started.map((s) => [s.from, s.task])).toEqual([
            ['main', 'Check repo a.'],
            ['main', 'Check repo b.'],
        ]);
        expect(new Set(started.map((s) => s.key)).size).toBe(2);
    }, 30_000);

    it('gives a subagent its tools but not sedge’s actions', async () => {
        const { faux, open, runIn } = await setup();
        const offered: Array<Array<string>> = [];
        const names = (context: unknown) =>
            [...JSON.stringify(context).matchAll(/"name":"([a-z_]+)","description"/g)].map(
                (m) => m[1]!,
            );
        faux.setResponses([
            (context) => {
                offered.push(names(context));
                return fauxAssistantMessage('sub');
            },
            (context) => {
                offered.push(names(context));
                return fauxAssistantMessage('main');
            },
        ]);
        const runtime = open();
        await runIn(runtime, 'main#sub:1', [{ id: 'event-10', text: 'a task' }], true);
        await runIn(runtime, 'main', [{ id: 'event-11', text: 'hi' }]);
        await runtime.dispose();
        const [sub, main] = offered;
        for (const action of ['send_message', 'tell', 'subagent', 'set_timer']) {
            expect(sub, action).not.toContain(action);
            expect(main, action).toContain(action);
        }
        expect(sub).toContain('bash');
        expect(sub).toContain('read');
    }, 30_000);

    it('triages events with one cheap call, and wakes the agent when the answer is unclear', async () => {
        const { faux, open } = await setup();
        const seen: Array<string> = [];
        faux.setResponses([
            (context) => {
                seen.push(JSON.stringify(context));
                return fauxAssistantMessage('SKIP: the soil is still moist');
            },
            fauxAssistantMessage('I think the user would want to know.'),
        ]);
        const runtime = open();
        const [skip, unclear] = await runtime.runPromise(
            Effect.gen(function* () {
                const agent = yield* Agent;
                return [yield* agent.triage(['soil at 48%']), yield* agent.triage(['soil at 12%'])];
            }),
        );
        await runtime.dispose();
        expect(skip).toMatchObject({ wake: false, reason: 'the soil is still moist' });
        expect(unclear?.wake).toBe(true);
        expect(seen[0]).toContain('soil at 48%');
        expect(seen[0]).toContain('WAKE or SKIP');
    }, 30_000);

    it('reports what each run used', async () => {
        const { faux, open, dir } = await setup();
        faux.setResponses([fauxAssistantMessage('first answer'), fauxAssistantMessage('second')]);
        const runtime = open();
        const spent: Array<{ tokens: number; cost: number }> = [];
        const ask = (id: string, text: string) =>
            runtime.runPromise(
                Effect.gen(function* () {
                    const agent = yield* Agent;
                    return yield* agent.run(
                        {
                            thread: 'main',
                            sources: ['telegram'],
                            cwd: dir,
                            items: [{ id, text }],
                            onSpent: (s) => spent.push(s),
                        },
                        () => Effect.void,
                    );
                }),
            );
        await ask('event-12', 'one');
        await ask('event-13', 'two');
        await runtime.dispose();
        expect(spent).toHaveLength(2);
        expect(spent[0]!.tokens).toBeGreaterThan(0);
        expect(spent[1]!.tokens).toBeGreaterThan(0);
    }, 30_000);

    it('labels each event with one of its own labels, and leaves out anything else', async () => {
        const { faux, open } = await setup();
        faux.setResponses([
            fauxAssistantMessage('1: Person\n2: dragon\n3: nothing\nWAKE: someone is at the door'),
        ]);
        const runtime = open();
        const verdict = await runtime.runPromise(
            Effect.gen(function* () {
                const agent = yield* Agent;
                return yield* agent.triage([
                    { text: 'motion at the door', labels: ['person', 'vehicle', 'nothing'] },
                    { text: 'motion in the yard', labels: ['person', 'vehicle', 'nothing'] },
                    { text: 'motion in the hall', labels: ['person', 'vehicle', 'nothing'] },
                ]);
            }),
        );
        await runtime.dispose();
        expect(verdict.wake).toBe(true);
        // "dragon" isn't one of its labels, so that event stays unlabelled.
        expect(verdict.labels).toEqual(['person', undefined, 'nothing']);
    }, 30_000);
});

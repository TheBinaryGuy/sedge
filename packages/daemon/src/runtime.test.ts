import { Agent, type RunInput, type Triage } from '@sedge-hq/agent';
import { AgentRunError } from '@sedge-hq/protocol';
import { sedgePaths } from '@sedge-hq/core';
import { Inbox, type InboxItem, StoresLive } from '@sedge-hq/db';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Connections } from './connections';
import { Runtime, WorkerWake } from './runtime';
import { Settings } from './settings';
import { openTelemetry } from './telemetry';
import { subagentThread } from './threads';

/** The runtime over real stores, with `answer` and `triage` standing in for the model. */
const setup = async (
    answer: (input: RunInput) => Promise<string>,
    triage?: {
        sources: ReadonlySet<string>;
        decide: (events: ReadonlyArray<string>) => Promise<Triage>;
    },
) => {
    const paths = sedgePaths(await mkdtemp(join(tmpdir(), 'sedge-runtime-')));
    const deps = Layer.mergeAll(
        StoresLive(':memory:'),
        WorkerWake.layer,
        Settings.layer(paths, { dreaming: false }),
        await openTelemetry(paths),
        Layer.succeed(Agent)(
            Agent.of({
                run: (input) => Effect.promise(() => answer(input)),
                triage: (events) =>
                    Effect.tryPromise({
                        try: () => triage!.decide(events),
                        catch: (cause) => new AgentRunError({ message: String(cause) }),
                    }),
                abort: Effect.void,
            }),
        ),
        Layer.succeed(Connections)(
            Connections.of({
                working: () => Effect.void,
                triaged: (sources: ReadonlyArray<string>) =>
                    Effect.succeed(
                        triage !== undefined && sources.every((s) => triage.sources.has(s)),
                    ),
            } as never),
        ),
    );
    const runtime = ManagedRuntime.make(Runtime.layer.pipe(Layer.provideMerge(deps)));
    const enqueue = (thread: string, prompt: string, source = 'telegram') =>
        runtime.runPromise(
            Effect.gen(function* () {
                yield* Runtime;
                yield* (yield* Inbox).enqueue({ source, thread, prompt, cwd: paths.workspace });
                yield* (yield* WorkerWake).wake;
            }),
        );
    /** Waits until every event is done, and returns them oldest first. */
    const settled = async (count: number): Promise<ReadonlyArray<InboxItem>> => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            const items = await runtime.runPromise(
                Effect.gen(function* () {
                    return yield* (yield* Inbox).list({ limit: 100 });
                }),
            );
            if (items.length >= count && items.every((item) => item.status === 'done'))
                return [...items].reverse();
            await new Promise((done) => setTimeout(done, 20));
        }
        throw new Error('The events never settled.');
    };
    return { runtime, enqueue, settled };
};

describe('the inbox worker', () => {
    it('runs every conversation with work at the same time, however many there are', async () => {
        const threads = Array.from({ length: 8 }, (_, i) => `agent:a${i}`);
        let started = 0;
        let everyone: () => void = () => {};
        const all = new Promise<void>((resolve) => (everyone = resolve));
        // Each run waits for all the others to start: with a cap below 8, this never finishes.
        const { runtime, enqueue, settled } = await setup(async (input) => {
            if (++started === threads.length) everyone();
            await Promise.race([
                all,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('not all at once')), 5_000),
                ),
            ]);
            return `done ${input.thread}`;
        });
        for (const thread of threads) await enqueue(thread, 'go');
        const items = await settled(threads.length);
        await runtime.dispose();
        expect(new Set(items.map((item) => item.result))).toEqual(
            new Set(threads.map((thread) => `done ${thread}`)),
        );
    }, 20_000);

    it('gives a subagent’s answer to the agent that started it', async () => {
        const seen: Array<RunInput> = [];
        const { runtime, enqueue, settled } = await setup(async (input) => {
            seen.push(input);
            return input.subagent ? 'Found 3 flaky tests.' : 'Thanks.';
        });
        await enqueue(subagentThread('agent:ci', 'ab12cd34'), 'Find the flaky tests.', 'agent:ci');
        const items = await settled(2);
        await runtime.dispose();

        expect(seen.map((input) => [input.thread, input.subagent])).toEqual([
            ['agent:ci#sub:ab12cd34', true],
            ['agent:ci', false],
        ]);
        const report = items.find((item) => item.thread === 'agent:ci');
        expect(report?.source).toBe('subagent:ab12cd34');
        expect(report?.prompt).toBe('Subagent ab12cd34 answered:\n\nFound 3 flaky tests.');
    }, 20_000);

    it('lets triage skip a signal’s events without waking the agent, and says why', async () => {
        const ran: Array<string> = [];
        const asked: Array<ReadonlyArray<string>> = [];
        const { runtime, enqueue, settled } = await setup(
            async (input) => {
                ran.push(input.items.map((item) => item.text).join(' | '));
                return 'Watered the basil.';
            },
            {
                sources: new Set(['soil']),
                decide: async (events) => {
                    asked.push(events);
                    return events.some((e) => e.includes('12%'))
                        ? { wake: true, reason: 'dry', model: 'cheap/one' }
                        : { wake: false, reason: 'moisture is fine', model: 'cheap/one' };
                },
            },
        );
        await enqueue('main', 'soil at 48%', 'soil');
        let items = await settled(1);
        expect(ran).toEqual([]);
        expect(items[0]?.result).toBe('Skipped by triage (cheap/one): moisture is fine');

        await enqueue('main', 'soil at 12%', 'soil');
        items = await settled(2);
        await runtime.dispose();
        expect(ran).toHaveLength(1);
        expect(ran[0]).toContain('soil at 12%');
        expect(items.find((i) => i.prompt === 'soil at 12%')?.result).toBe('Watered the basil.');
        expect(asked).toEqual([['soil at 48%'], ['soil at 12%']]);
    }, 20_000);

    it('wakes the agent when triage fails, and never triages a message from you', async () => {
        const ran: Array<string> = [];
        const { runtime, enqueue, settled } = await setup(
            async (input) => {
                ran.push(input.items.map((item) => item.text).join(' | '));
                return 'ok';
            },
            {
                sources: new Set(['soil']),
                decide: async () => {
                    throw new Error('no model');
                },
            },
        );
        await enqueue('main', 'soil at 48%', 'soil');
        await settled(1);
        await enqueue('agent:other', 'hello', 'telegram');
        await settled(2);
        await runtime.dispose();
        expect(ran).toHaveLength(2);
        expect(ran[0]).toContain('soil at 48%');
        expect(ran[1]).toContain('hello');
    }, 20_000);
});

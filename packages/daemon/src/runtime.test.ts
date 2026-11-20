import { Agent, type RunInput } from '@sedge-hq/agent';
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

/** The runtime over real stores, with `answer` standing in for the model. */
const setup = async (answer: (input: RunInput) => Promise<string>) => {
    const paths = sedgePaths(await mkdtemp(join(tmpdir(), 'sedge-runtime-')));
    const deps = Layer.mergeAll(
        StoresLive(':memory:'),
        WorkerWake.layer,
        Settings.layer(paths, { dreaming: false }),
        await openTelemetry(paths),
        Layer.succeed(Agent)(
            Agent.of({ run: (input) => Effect.promise(() => answer(input)), abort: Effect.void }),
        ),
        Layer.succeed(Connections)(Connections.of({ working: () => Effect.void } as never)),
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
});

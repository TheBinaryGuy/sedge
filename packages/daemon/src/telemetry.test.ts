import { sedgePaths } from '@sedge-hq/core';
import { Effect, ManagedRuntime } from 'effect';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openTelemetry, Telemetry } from './telemetry';

const run = (id: string, ok: boolean) => ({
    id,
    thread: 'agent:ci',
    sources: ['github-ci'],
    events: 1,
    startedAt: 1_000,
    finishedAt: 4_000,
    ok,
    ...(ok ? {} : { error: 'model_error' }),
    tools: [{ name: 'bash', ms: 1200, error: false }],
});

describe('telemetry, kept on this machine', () => {
    it('records runs with their tools, keeps them across a restart, and counts them', async () => {
        const paths = sedgePaths(await mkdtemp(join(tmpdir(), 'sedge-telemetry-')));
        const first = ManagedRuntime.make(await openTelemetry(paths));
        const counted = await first.runPromise(
            Effect.gen(function* () {
                const telemetry = yield* Telemetry;
                yield* telemetry.recordRun(run('a', true));
                yield* telemetry.recordRun(run('b', false));
                const runs = (yield* telemetry.snapshot).find((m) => m.id === 'sedge_runs');
                return runs?.type === 'Frequency' ? Object.fromEntries(runs.state.occurrences) : {};
            }),
        );
        // Effect's metrics, in memory: runs by thread and outcome.
        expect(counted).toMatchObject({ 'agent:ci:ok': 1, 'agent:ci:failed': 1 });
        await first.dispose();
        await Bun.sleep(50);
        expect(
            (await readFile(join(paths.logs, 'runs.jsonl'), 'utf8')).trim().split('\n'),
        ).toHaveLength(2);

        // A new daemon reads them back; the newest first.
        const second = ManagedRuntime.make(await openTelemetry(paths));
        const runs = await second.runPromise(
            Effect.gen(function* () {
                return yield* (yield* Telemetry).runs({ thread: 'agent:ci', limit: 10 });
            }),
        );
        expect(runs.map((r) => [r.id, r.ok, r.tools[0]?.name])).toEqual([
            ['b', false, 'bash'],
            ['a', true, 'bash'],
        ]);
        await second.dispose();
    });

    it('logs what Effect logs and what code prints, each at its level', async () => {
        const paths = sedgePaths(await mkdtemp(join(tmpdir(), 'sedge-telemetry-')));
        const layer = await openTelemetry(paths);
        const runtime = ManagedRuntime.make(layer);
        const logs = await runtime.runPromise(
            Effect.gen(function* () {
                yield* Effect.logWarning('the inbox is slow');
                console.error('[agent] mcp github: failed: 401');
                return yield* (yield* Telemetry).logs({ level: 'warn', limit: 10 });
            }),
        );
        await runtime.dispose();
        expect(logs.map((l) => [l.level, l.from, l.message])).toEqual([
            ['error', 'console', '[agent] mcp github: failed: 401'],
            ['warn', 'daemon', 'the inbox is slow'],
        ]);
    });
});

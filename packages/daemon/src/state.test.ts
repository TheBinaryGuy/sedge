import { StoresLive } from '@sedge-hq/db';
import { Kv } from '@sedge-hq/db';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { State } from './state';

const open = (file: string) =>
    ManagedRuntime.make(State.layer.pipe(Layer.provideMerge(StoresLive(file))));

describe('named values', () => {
    it('keeps what was set across a restart, and forgets on request', async () => {
        const file = join(await mkdtemp(join(tmpdir(), 'sedge-state-')), 'sedge.db');
        const first = open(file);
        await first.runPromise(
            Effect.gen(function* () {
                const state = yield* State;
                yield* state.set('mode', 'away', 'agent:main');
                yield* state.set('soil', 24, 'basil');
            }),
        );
        await first.dispose();

        const second = open(file);
        const [snapshot, mode] = await second.runPromise(
            Effect.gen(function* () {
                const state = yield* State;
                const before = state.snapshot();
                const mode = yield* state.get('mode');
                yield* state.set('soil', null, 'basil');
                return [{ before, after: state.snapshot() }, mode] as const;
            }),
        );
        await second.dispose();
        expect(snapshot.before).toEqual({ mode: 'away', soil: 24 });
        expect(snapshot.after).toEqual({ mode: 'away' });
        expect(mode).toMatchObject({ name: 'mode', value: 'away', by: 'agent:main' });
    });

    it('lists only keys with exactly that prefix', async () => {
        const runtime = ManagedRuntime.make(StoresLive(':memory:'));
        const keys = await runtime.runPromise(
            Effect.gen(function* () {
                const kv = yield* Kv;
                yield* kv.set('state:a', '1');
                yield* kv.set('stateXb', '2');
                yield* kv.set('state_c', '3');
                return (yield* kv.entries('state:')).map((e) => e.key);
            }),
        );
        await runtime.dispose();
        expect(keys).toEqual(['state:a']);
    });
});

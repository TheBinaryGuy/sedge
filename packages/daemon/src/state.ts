import { Kv } from '@sedge-hq/db';
import { Context, Effect, Layer } from 'effect';

/** A name conditions can read as `state.<name>`: letters, digits, `_` and `-`. */
export const STATE_NAME = /^[a-z][a-z0-9_-]{0,63}$/i;

export interface NamedValue {
    readonly name: string;
    readonly value: unknown;
    /** When it was set (ms). */
    readonly at: number;
    /** Who set it: a signal's name, or `agent:<name>`. */
    readonly by: string;
}

const KEY = 'state:';

/**
 * Named values: small facts like `mode = away` that a signal remembers or an agent sets, and that
 * signals' conditions read as `state.<name>`. Kept in the store so they survive restarts, and in
 * memory so a condition reads them without waiting.
 */
export class State extends Context.Service<
    State,
    {
        /** Every value by name, as conditions see them. */
        readonly snapshot: () => Readonly<Record<string, unknown>>;
        readonly all: Effect.Effect<ReadonlyArray<NamedValue>>;
        readonly get: (name: string) => Effect.Effect<NamedValue | undefined>;
        /** Sets a value; `null` or `undefined` forgets it. */
        readonly set: (name: string, value: unknown, by: string) => Effect.Effect<void>;
    }
>()('sedge/daemon/State') {
    static readonly layer = Layer.effect(
        State,
        Effect.gen(function* () {
            const kv = yield* Kv;
            const values = new Map<string, NamedValue>();
            for (const { key, value } of yield* kv.entries(KEY)) {
                try {
                    const saved = JSON.parse(value) as Omit<NamedValue, 'name'>;
                    values.set(key.slice(KEY.length), { name: key.slice(KEY.length), ...saved });
                } catch {
                    // A value that doesn't read is left out.
                }
            }

            const set = Effect.fn('State.set')(function* (
                name: string,
                value: unknown,
                by: string,
            ) {
                if (value === null || value === undefined) {
                    values.delete(name);
                    yield* kv.delete(KEY + name);
                    return;
                }
                const entry: NamedValue = { name, value, at: Date.now(), by };
                values.set(name, entry);
                yield* kv.set(KEY + name, JSON.stringify({ value, at: entry.at, by }));
            });

            return State.of({
                snapshot: () =>
                    Object.fromEntries([...values].map(([name, entry]) => [name, entry.value])),
                all: Effect.sync(() =>
                    [...values.values()].sort((a, b) => a.name.localeCompare(b.name)),
                ),
                get: (name) => Effect.sync(() => values.get(name)),
                set,
            });
        }),
    );
}

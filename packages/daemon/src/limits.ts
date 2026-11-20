import type { Spent } from '@sedge-hq/agent';
import { loadConfig, type SedgeConfig } from '@sedge-hq/core';
import { Kv, Outbox } from '@sedge-hq/db';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { stat } from 'node:fs/promises';
import { Settings } from './settings';
import { MAIN } from './threads';

export type LimitSettings = NonNullable<SedgeConfig['limits']>;

/** The local day, as the key today's usage is kept under. */
export const dayOf = (ms: number) => {
    const date = new Date(ms);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Sources that come from you: your channels' messages, your approvals, the terminal. */
export const fromYou = (source: string, channels: ReadonlySet<string>) =>
    source === 'cli' || source === 'approval' || channels.has(source);

/**
 * What the agents may use: runs per hour, tokens and money per day, subagents at once. Each limit
 * is off until set in `limits` in config.json, which is read again when the file changes, so a new
 * limit applies without a restart. Today's usage is kept in the store, so a restart doesn't reset it.
 */
export class Limits extends Context.Service<
    Limits,
    {
        readonly current: Effect.Effect<LimitSettings>;
        /** Adds what a run or a triage call used to today's total. */
        readonly spend: (spent: Spent) => Effect.Effect<void>;
        readonly today: Effect.Effect<Spent>;
        /** Why today's budget stops automated work, or `undefined` while there's room. */
        readonly overBudget: Effect.Effect<string | undefined>;
        /** Tells the user, once for each `key`. */
        readonly notify: (key: string, text: string) => Effect.Effect<void>;
    }
>()('sedge/daemon/Limits') {
    static readonly layer = Layer.effect(
        Limits,
        Effect.gen(function* () {
            const { paths, config } = yield* Settings;
            const kv = yield* Kv;
            const outbox = yield* Outbox;
            const lock = yield* Semaphore.make(1);

            let cached = { mtime: Number.NaN, limits: config.limits ?? {} };
            const current = Effect.promise(async () => {
                const mtime = (await stat(paths.config).catch(() => undefined))?.mtimeMs;
                // No file: the limits the daemon started with stand.
                if (mtime !== undefined && mtime !== cached.mtime) {
                    const loaded = await loadConfig(paths).catch(() => undefined);
                    // A config that doesn't read keeps the limits that did.
                    cached = { mtime, limits: loaded ? (loaded.limits ?? {}) : cached.limits };
                }
                return cached.limits;
            });

            const usageKey = () => `usage:${dayOf(Date.now())}`;
            const today = kv
                .get(usageKey())
                .pipe(
                    Effect.map((saved): Spent =>
                        saved ? (JSON.parse(saved) as Spent) : { tokens: 0, cost: 0 },
                    ),
                );
            const spend = (spent: Spent) =>
                lock.withPermits(1)(
                    Effect.gen(function* () {
                        if (spent.tokens === 0 && spent.cost === 0) return;
                        const so = yield* today;
                        yield* kv.set(
                            usageKey(),
                            JSON.stringify({
                                tokens: so.tokens + spent.tokens,
                                cost: so.cost + spent.cost,
                            }),
                        );
                    }),
                );

            const overBudget = Effect.gen(function* () {
                const limits = yield* current;
                if (limits.dailyTokens === undefined && limits.dailyCost === undefined)
                    return undefined;
                const so = yield* today;
                if (limits.dailyTokens !== undefined && so.tokens >= limits.dailyTokens) {
                    return `today's ${limits.dailyTokens.toLocaleString()} tokens are used up (${so.tokens.toLocaleString()} so far)`;
                }
                if (limits.dailyCost !== undefined && so.cost >= limits.dailyCost) {
                    return `today's budget of $${limits.dailyCost.toFixed(2)} is used up ($${so.cost.toFixed(2)} so far)`;
                }
                return undefined;
            });

            const notify = (key: string, text: string) =>
                Effect.gen(function* () {
                    const seen = `notice:${key}`;
                    if (yield* kv.get(seen)) return;
                    yield* kv.set(seen, String(Date.now()));
                    yield* outbox.enqueue({ thread: MAIN, text });
                });

            return Limits.of({ current, spend, today, overBudget, notify });
        }),
    );
}

import { and, count, eq, lte } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { timers, type Timer } from './schema';

export class Timers extends Context.Service<
    Timers,
    {
        readonly due: (now: number) => Effect.Effect<ReadonlyArray<Timer>>;
        readonly markRan: (id: string, ranAt: number, nextRunAt: number) => Effect.Effect<void>;
        readonly count: Effect.Effect<number>;
    }
>()('sedge/db/Timers') {
    static readonly layer = Layer.effect(
        Timers,
        Effect.gen(function* () {
            const db = yield* Database;

            const due = (now: number) =>
                db
                    .select()
                    .from(timers)
                    .where(and(eq(timers.enabled, true), lte(timers.nextRunAt, now)))
                    .pipe(Effect.orDie);

            const markRan = (id: string, ranAt: number, nextRunAt: number) =>
                db
                    .update(timers)
                    .set({ lastRunAt: ranAt, nextRunAt })
                    .where(eq(timers.id, id))
                    .pipe(Effect.asVoid, Effect.orDie);

            const total = db
                .select({ n: count() })
                .from(timers)
                .where(eq(timers.enabled, true))
                .pipe(
                    Effect.map((rows) => rows[0]?.n ?? 0),
                    Effect.orDie,
                );

            return Timers.of({ due, markRan, count: total });
        }),
    );
}

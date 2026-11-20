import { and, asc, count, eq, lte } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { timers, type Timer } from './schema';

export interface NewTimer {
    readonly kind: Timer['kind'];
    readonly thread: string;
    readonly name?: string | undefined;
    readonly cron?: string | undefined;
    readonly prompt: string;
    readonly cwd: string;
    readonly nextRunAt: number;
    /** Set by a run woken by outside content. */
    readonly untrusted?: boolean | undefined;
}

export class Timers extends Context.Service<
    Timers,
    {
        readonly create: (timer: NewTimer) => Effect.Effect<Timer>;
        readonly due: (now: number) => Effect.Effect<ReadonlyArray<Timer>>;
        /**
         * Records that a timer fired: a follow-up is done, a schedule moves to `nextRunAt`
         * (computed by the caller from its cron).
         */
        readonly markFired: (
            timer: Timer,
            firedAt: number,
            nextRunAt?: number,
        ) => Effect.Effect<void>;
        readonly list: (thread?: string) => Effect.Effect<ReadonlyArray<Timer>>;
        /** Cancels an active timer; when `thread` is given, only that thread's. */
        readonly cancel: (id: string, thread?: string) => Effect.Effect<boolean>;
        readonly count: Effect.Effect<number>;
    }
>()('sedge/db/Timers') {
    static readonly layer = Layer.effect(
        Timers,
        Effect.gen(function* () {
            const db = yield* Database;
            const active = eq(timers.status, 'active');

            const create = (timer: NewTimer) =>
                db
                    .insert(timers)
                    .values({ id: crypto.randomUUID().slice(0, 8), ...timer })
                    .returning()
                    .pipe(
                        Effect.map((rows) => rows[0]!),
                        Effect.orDie,
                    );

            const due = (now: number) =>
                db
                    .select()
                    .from(timers)
                    .where(and(active, lte(timers.nextRunAt, now)))
                    .pipe(Effect.orDie);

            const markFired = (timer: Timer, firedAt: number, nextRunAt?: number) =>
                db
                    .update(timers)
                    .set(
                        timer.kind === 'followup' || nextRunAt === undefined
                            ? { status: 'done', lastRunAt: firedAt }
                            : { lastRunAt: firedAt, nextRunAt },
                    )
                    .where(eq(timers.id, timer.id))
                    .pipe(Effect.asVoid, Effect.orDie);

            const list = (thread?: string) =>
                db
                    .select()
                    .from(timers)
                    .where(thread ? and(active, eq(timers.thread, thread)) : active)
                    .orderBy(asc(timers.nextRunAt))
                    .pipe(Effect.orDie);

            const cancel = (id: string, thread?: string) =>
                db
                    .update(timers)
                    .set({ status: 'cancelled' })
                    .where(
                        and(
                            eq(timers.id, id),
                            active,
                            ...(thread ? [eq(timers.thread, thread)] : []),
                        ),
                    )
                    .returning({ id: timers.id })
                    .pipe(
                        Effect.map((rows) => rows.length > 0),
                        Effect.orDie,
                    );

            const total = db
                .select({ n: count() })
                .from(timers)
                .where(active)
                .pipe(
                    Effect.map((rows) => rows[0]?.n ?? 0),
                    Effect.orDie,
                );

            return Timers.of({ create, due, markFired, list, cancel, count: total });
        }),
    );
}

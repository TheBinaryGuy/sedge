import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { inbox, type InboxItem } from './schema';

export interface NewEvent {
    readonly source: string;
    /** The source's own id for this event; a second event with the same one is dropped. */
    readonly externalId?: string | undefined;
    readonly thread: string;
    readonly prompt: string;
    readonly cwd: string;
}

export type Outcome = { readonly result: string } | { readonly error: string };

/**
 * The durable queue in front of the agent. Only the daemon's single worker claims and finishes
 * events, so two runs never compete for a thread.
 */
export class Inbox extends Context.Service<
    Inbox,
    {
        /** Appends an event; `undefined` when the source already delivered it. */
        readonly enqueue: (event: NewEvent) => Effect.Effect<InboxItem | undefined>;
        /**
         * Claims every pending event of the thread whose oldest event is next in line, so several
         * messages sent in a row become one run and one reply.
         */
        readonly claimBatch: Effect.Effect<ReadonlyArray<InboxItem>>;
        readonly get: (id: string) => Effect.Effect<InboxItem | undefined>;
        readonly finish: (ids: ReadonlyArray<string>, outcome: Outcome) => Effect.Effect<void>;
        readonly pendingCount: Effect.Effect<number>;
        /** Events left `running` by a crash go back to the front of the queue. */
        readonly recoverInterrupted: Effect.Effect<number>;
    }
>()('sedge/db/Inbox') {
    static readonly layer = Layer.effect(
        Inbox,
        Effect.gen(function* () {
            const db = yield* Database;

            const enqueue = Effect.fn('Inbox.enqueue')(function* (event: NewEvent) {
                const [row] = yield* db
                    .insert(inbox)
                    .values({ id: crypto.randomUUID(), ...event })
                    .onConflictDoNothing()
                    .returning();
                return row;
            }, Effect.orDie);

            const claimBatch = db
                .transaction((tx) =>
                    Effect.gen(function* () {
                        const [next] = yield* tx
                            .select({ thread: inbox.thread })
                            .from(inbox)
                            .where(eq(inbox.status, 'pending'))
                            .orderBy(asc(inbox.createdAt), sql`rowid`)
                            .limit(1);
                        if (!next) return [];
                        return yield* tx
                            .update(inbox)
                            .set({ status: 'running', startedAt: Date.now() })
                            .where(and(eq(inbox.thread, next.thread), eq(inbox.status, 'pending')))
                            .returning();
                    }),
                )
                .pipe(
                    Effect.map((rows) => [...rows].sort((a, b) => a.createdAt - b.createdAt)),
                    Effect.orDie,
                    Effect.withSpan('Inbox.claimBatch'),
                );

            const get = (id: string) =>
                db
                    .select()
                    .from(inbox)
                    .where(eq(inbox.id, id))
                    .pipe(
                        Effect.map((rows) => rows[0]),
                        Effect.orDie,
                    );

            const finish = Effect.fn('Inbox.finish')(function* (
                ids: ReadonlyArray<string>,
                outcome: Outcome,
            ) {
                if (ids.length === 0) return;
                yield* db
                    .update(inbox)
                    .set({
                        status: 'result' in outcome ? 'done' : 'failed',
                        result: 'result' in outcome ? outcome.result : null,
                        error: 'error' in outcome ? outcome.error : null,
                        finishedAt: Date.now(),
                    })
                    .where(inArray(inbox.id, [...ids]));
            }, Effect.orDie);

            const pendingCount = db
                .select({ n: count() })
                .from(inbox)
                .where(eq(inbox.status, 'pending'))
                .pipe(
                    Effect.map((rows) => rows[0]?.n ?? 0),
                    Effect.orDie,
                );

            const recoverInterrupted = db
                .update(inbox)
                .set({ status: 'pending', startedAt: null })
                .where(eq(inbox.status, 'running'))
                .returning({ id: inbox.id })
                .pipe(
                    Effect.map((rows) => rows.length),
                    Effect.orDie,
                );

            return Inbox.of({ enqueue, claimBatch, get, finish, pendingCount, recoverInterrupted });
        }),
    );
}

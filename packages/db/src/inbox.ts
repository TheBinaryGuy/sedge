import { and, asc, count, eq, sql } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { inbox, type InboxItem } from './schema';

export interface NewInboxItem {
    readonly source: InboxItem['source'];
    readonly prompt: string;
    readonly cwd: string;
}

/**
 * The durable queue in front of the agent. `claimNext` and `finish` are the only way an item
 * changes state, and only the daemon's single worker calls them.
 */
export class Inbox extends Context.Service<
    Inbox,
    {
        readonly enqueue: (item: NewInboxItem) => Effect.Effect<InboxItem>;
        readonly claimNext: Effect.Effect<InboxItem | undefined>;
        readonly get: (id: string) => Effect.Effect<InboxItem | undefined>;
        readonly finish: (
            id: string,
            outcome: { readonly result: string } | { readonly error: string },
        ) => Effect.Effect<void>;
        readonly pendingCount: Effect.Effect<number>;
        /** Items left `running` by a crash go back to the front of the queue. */
        readonly recoverInterrupted: Effect.Effect<number>;
    }
>()('sedge/db/Inbox') {
    static readonly layer = Layer.effect(
        Inbox,
        Effect.gen(function* () {
            const db = yield* Database;

            const enqueue = Effect.fn('Inbox.enqueue')(function* (item: NewInboxItem) {
                const [row] = yield* db
                    .insert(inbox)
                    .values({ id: crypto.randomUUID(), ...item })
                    .returning();
                return row!;
            }, Effect.orDie);

            const claimNext = db
                .transaction((tx) =>
                    Effect.gen(function* () {
                        const [next] = yield* tx
                            .select()
                            .from(inbox)
                            .where(eq(inbox.status, 'pending'))
                            .orderBy(asc(inbox.createdAt), sql`rowid`)
                            .limit(1);
                        if (!next) return undefined;
                        const [claimed] = yield* tx
                            .update(inbox)
                            .set({ status: 'running', startedAt: Date.now() })
                            .where(and(eq(inbox.id, next.id), eq(inbox.status, 'pending')))
                            .returning();
                        return claimed;
                    }),
                )
                .pipe(Effect.orDie, Effect.withSpan('Inbox.claimNext'));

            const finish = Effect.fn('Inbox.finish')(function* (
                id: string,
                outcome: { readonly result: string } | { readonly error: string },
            ) {
                yield* db
                    .update(inbox)
                    .set({
                        status: 'result' in outcome ? 'done' : 'failed',
                        result: 'result' in outcome ? outcome.result : null,
                        error: 'error' in outcome ? outcome.error : null,
                        finishedAt: Date.now(),
                    })
                    .where(eq(inbox.id, id));
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

            const get = (id: string) =>
                db
                    .select()
                    .from(inbox)
                    .where(eq(inbox.id, id))
                    .pipe(
                        Effect.map((rows) => rows[0]),
                        Effect.orDie,
                    );

            return Inbox.of({ enqueue, claimNext, get, finish, pendingCount, recoverInterrupted });
        }),
    );
}

import { and, asc, count, desc, eq, inArray, like, notInArray, or, sql } from 'drizzle-orm';
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
    /** Wait until this time (ms): a batching signal's events go to the agent together. */
    readonly holdUntil?: number | undefined;
}

/** A waiting event, as `claimBatch`'s `eligible` sees it. */
export interface Waiting {
    readonly id: string;
    readonly thread: string;
    readonly source: string;
    readonly holdUntil: number | null;
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
         * messages sent in a row become one run and one reply. Threads in `busy` are skipped: they
         * have a run going, and one thread never has two. An event held until later doesn't start
         * a run, but goes along with one that starts sooner. Events `eligible` turns down stay
         * waiting, as if they weren't there (a limit has been reached, say).
         */
        readonly claimBatch: (
            busy?: ReadonlyArray<string>,
            eligible?: (item: Waiting) => boolean,
        ) => Effect.Effect<ReadonlyArray<InboxItem>>;
        /** Threads with an event waiting or being worked on. */
        readonly activeThreads: Effect.Effect<ReadonlyArray<string>>;
        /** The latest events, newest first; one thread's (with its subagents'), or all. */
        readonly list: (options: {
            readonly thread?: string | undefined;
            readonly limit: number;
        }) => Effect.Effect<ReadonlyArray<InboxItem>>;
        /** Pending events by thread. */
        readonly pendingByThread: Effect.Effect<Readonly<Record<string, number>>>;
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

            const claimBatch = (
                busy: ReadonlyArray<string> = [],
                eligible: (item: Waiting) => boolean = () => true,
            ) =>
                db
                    .transaction((tx) =>
                        Effect.gen(function* () {
                            const now = Date.now();
                            const waiting = (yield* tx
                                .select({
                                    id: inbox.id,
                                    thread: inbox.thread,
                                    source: inbox.source,
                                    holdUntil: inbox.holdUntil,
                                })
                                .from(inbox)
                                .where(
                                    and(
                                        eq(inbox.status, 'pending'),
                                        busy.length > 0
                                            ? notInArray(inbox.thread, [...busy])
                                            : undefined,
                                    ),
                                )
                                .orderBy(asc(inbox.createdAt), sql`rowid`)).filter(eligible);
                            const next = waiting.find(
                                (item) => item.holdUntil === null || item.holdUntil <= now,
                            );
                            if (!next) return [];
                            const ids = waiting
                                .filter((item) => item.thread === next.thread)
                                .map((item) => item.id);
                            return yield* tx
                                .update(inbox)
                                .set({ status: 'running', startedAt: now })
                                .where(and(inArray(inbox.id, ids), eq(inbox.status, 'pending')))
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

            const list = (options: {
                readonly thread?: string | undefined;
                readonly limit: number;
            }) =>
                db
                    .select()
                    .from(inbox)
                    .where(
                        // A thread's own events, and its subagents'.
                        options.thread === undefined
                            ? undefined
                            : or(
                                  eq(inbox.thread, options.thread),
                                  like(inbox.thread, `${options.thread}#sub:%`),
                              ),
                    )
                    .orderBy(desc(inbox.createdAt), sql`rowid desc`)
                    .limit(options.limit)
                    .pipe(Effect.orDie);

            const pendingByThread = db
                .select({ thread: inbox.thread, n: count() })
                .from(inbox)
                .where(eq(inbox.status, 'pending'))
                .groupBy(inbox.thread)
                .pipe(
                    Effect.map((rows) =>
                        Object.fromEntries(rows.map((row) => [row.thread, row.n])),
                    ),
                    Effect.orDie,
                );

            const activeThreads = db
                .selectDistinct({ thread: inbox.thread })
                .from(inbox)
                .where(inArray(inbox.status, ['pending', 'running']))
                .pipe(
                    Effect.map((rows) => rows.map((row) => row.thread)),
                    Effect.orDie,
                );

            return Inbox.of({
                enqueue,
                claimBatch,
                activeThreads,
                list,
                pendingByThread,
                get,
                finish,
                pendingCount,
                recoverInterrupted,
            });
        }),
    );
}

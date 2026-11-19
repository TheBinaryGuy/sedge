import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { outbox, type OutboxExtra, type OutboxMessage } from './schema';

export interface NewOutboxMessage {
    readonly thread: string;
    readonly text: string;
    readonly kind?: OutboxMessage['kind'];
    readonly approvalId?: string | undefined;
    readonly extra?: OutboxExtra | undefined;
}

/** Messages leave only through here; the dispatcher delivers and retries them. */
export class Outbox extends Context.Service<
    Outbox,
    {
        readonly enqueue: (message: NewOutboxMessage) => Effect.Effect<OutboxMessage>;
        readonly due: (now: number, limit: number) => Effect.Effect<ReadonlyArray<OutboxMessage>>;
        readonly markSent: (id: string) => Effect.Effect<void>;
        /** Schedules another attempt, or gives up for good when `retryAt` is undefined. */
        readonly markFailed: (
            message: OutboxMessage,
            error: string,
            retryAt: number | undefined,
        ) => Effect.Effect<void>;
        /** Everything queued or sent, newest first; one thread's, or all. */
        readonly list: (options: {
            readonly thread?: string | undefined;
            readonly limit: number;
        }) => Effect.Effect<ReadonlyArray<OutboxMessage>>;
        /** The agent's latest messages to a thread, newest first: what it has already said. */
        readonly recent: (
            thread: string,
            limit: number,
        ) => Effect.Effect<ReadonlyArray<OutboxMessage>>;
    }
>()('sedge/db/Outbox') {
    static readonly layer = Layer.effect(
        Outbox,
        Effect.gen(function* () {
            const db = yield* Database;

            const enqueue = (message: NewOutboxMessage) =>
                db
                    .insert(outbox)
                    .values({ id: crypto.randomUUID(), nextAttemptAt: Date.now(), ...message })
                    .returning()
                    .pipe(
                        Effect.map((rows) => rows[0]!),
                        Effect.orDie,
                    );

            const due = (now: number, limit: number) =>
                db
                    .select()
                    .from(outbox)
                    .where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, now)))
                    .orderBy(asc(outbox.createdAt))
                    .limit(limit)
                    .pipe(Effect.orDie);

            const markSent = (id: string) =>
                db
                    .update(outbox)
                    .set({ status: 'sent', sentAt: Date.now(), error: null })
                    .where(eq(outbox.id, id))
                    .pipe(Effect.asVoid, Effect.orDie);

            const markFailed = (
                message: OutboxMessage,
                error: string,
                retryAt: number | undefined,
            ) =>
                db
                    .update(outbox)
                    .set({
                        attempts: message.attempts + 1,
                        error,
                        ...(retryAt === undefined
                            ? { status: 'failed' as const }
                            : { nextAttemptAt: retryAt }),
                    })
                    .where(eq(outbox.id, message.id))
                    .pipe(Effect.asVoid, Effect.orDie);

            const list = (options: {
                readonly thread?: string | undefined;
                readonly limit: number;
            }) =>
                db
                    .select()
                    .from(outbox)
                    .where(
                        options.thread === undefined
                            ? undefined
                            : eq(outbox.thread, options.thread),
                    )
                    .orderBy(desc(outbox.createdAt))
                    .limit(options.limit)
                    .pipe(Effect.orDie);

            const recent = (thread: string, limit: number) =>
                db
                    .select()
                    .from(outbox)
                    .where(and(eq(outbox.thread, thread), eq(outbox.kind, 'message')))
                    .orderBy(desc(outbox.createdAt))
                    .limit(limit)
                    .pipe(Effect.orDie);

            return Outbox.of({ list, enqueue, due, markSent, markFailed, recent });
        }),
    );
}

import { and, eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Database } from './database';
import { approvals, type Approval } from './schema';

export interface ApprovalRequest {
    readonly thread: string;
    readonly toolName: string;
    readonly inputHash: string;
    readonly summary: string;
    /** Asked by a run woken by outside content. */
    readonly untrusted?: boolean | undefined;
}

/** Deferred tool calls: asked once, answered through the inbox, usable once when approved. */
export class Approvals extends Context.Service<
    Approvals,
    {
        /** Records a request, or returns the pending one for the same call. */
        readonly request: (
            request: ApprovalRequest,
        ) => Effect.Effect<{ readonly approval: Approval; readonly created: boolean }>;
        /** Spends an approval for exactly this call. True when one existed. */
        readonly consume: (thread: string, inputHash: string) => Effect.Effect<boolean>;
        /** Answers a pending request. Undefined when it was already answered or doesn't exist. */
        readonly decide: (id: string, approved: boolean) => Effect.Effect<Approval | undefined>;
    }
>()('sedge/db/Approvals') {
    static readonly layer = Layer.effect(
        Approvals,
        Effect.gen(function* () {
            const db = yield* Database;

            const request = (input: ApprovalRequest) =>
                db
                    .transaction((tx) =>
                        Effect.gen(function* () {
                            const [pending] = yield* tx
                                .select()
                                .from(approvals)
                                .where(
                                    and(
                                        eq(approvals.thread, input.thread),
                                        eq(approvals.inputHash, input.inputHash),
                                        eq(approvals.status, 'pending'),
                                    ),
                                )
                                .limit(1);
                            if (pending) return { approval: pending, created: false };
                            const [approval] = yield* tx
                                .insert(approvals)
                                .values({ id: crypto.randomUUID().slice(0, 8), ...input })
                                .returning();
                            return { approval: approval!, created: true };
                        }),
                    )
                    .pipe(Effect.orDie);

            const consume = (thread: string, inputHash: string) =>
                db
                    .transaction((tx) =>
                        Effect.gen(function* () {
                            const [approved] = yield* tx
                                .select({ id: approvals.id })
                                .from(approvals)
                                .where(
                                    and(
                                        eq(approvals.thread, thread),
                                        eq(approvals.inputHash, inputHash),
                                        eq(approvals.status, 'approved'),
                                    ),
                                )
                                .limit(1);
                            if (!approved) return false;
                            yield* tx
                                .update(approvals)
                                .set({ status: 'used' })
                                .where(eq(approvals.id, approved.id));
                            return true;
                        }),
                    )
                    .pipe(Effect.orDie);

            const decide = (id: string, approved: boolean) =>
                db
                    .update(approvals)
                    .set({ status: approved ? 'approved' : 'denied', decidedAt: Date.now() })
                    .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
                    .returning()
                    .pipe(
                        Effect.map((rows) => rows[0]),
                        Effect.orDie,
                    );

            return Approvals.of({ request, consume, decide });
        }),
    );
}

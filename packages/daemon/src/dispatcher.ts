import { Outbox, type OutboxMessage } from '@sedge-hq/db';
import { Effect, Layer, Queue } from 'effect';
import { DispatcherWake } from './host';
import { Sources } from './sources';
import { supervise } from './supervise';

const MAX_ATTEMPTS = 6;
/** Keeps a pace chat services accept (Telegram allows about one message a second per chat). */
const PACE = '1100 millis';

/**
 * Delivers the outbox. Only the dispatcher talks to the user: the agent writes rows, this decides
 * when they go out, sends each through the source that reaches that conversation, retries what
 * fails (5 s, 10 s, 20 s …), and gives up after six attempts. Approval requests carry
 * approve/deny buttons, which come back from the source as actions.
 */
export const DispatcherLive = Layer.effect(
    DispatcherWake,
    Effect.gen(function* () {
        const outbox = yield* Outbox;
        const sources = yield* Sources;
        const wakeups = yield* Queue.sliding<void>(1);

        const deliver = (message: OutboxMessage) =>
            sources.send(message.thread, {
                text: message.text,
                ...(message.kind === 'approval' && message.approvalId
                    ? {
                          buttons: [
                              { label: '✅ Approve', data: `approve:${message.approvalId}` },
                              { label: '❌ Deny', data: `deny:${message.approvalId}` },
                          ],
                      }
                    : {}),
            });

        const drain = Effect.gen(function* () {
            for (const message of yield* outbox.due(Date.now(), 20)) {
                yield* deliver(message).pipe(
                    Effect.matchEffect({
                        // A thread nothing reaches (a terminal task) has nowhere to deliver; the
                        // TUI shows its result itself.
                        onSuccess: () => outbox.markSent(message.id),
                        onFailure: (error) => {
                            const retryAt =
                                message.attempts + 1 >= MAX_ATTEMPTS
                                    ? undefined
                                    : Date.now() + 5_000 * 2 ** message.attempts;
                            return outbox
                                .markFailed(message, error.message, retryAt)
                                .pipe(
                                    Effect.andThen(
                                        Effect.logWarning(
                                            `Outbox ${message.id} failed (${error.message}); ${retryAt ? 'retrying' : 'giving up'}`,
                                        ),
                                    ),
                                );
                        },
                    }),
                );
                yield* Effect.sleep(PACE);
            }
            yield* Queue.take(wakeups).pipe(Effect.timeoutOption('3 seconds'));
        });

        yield* Effect.forkScoped(supervise('Outbox dispatcher', drain));
        return DispatcherWake.of(Queue.offer(wakeups, undefined).pipe(Effect.asVoid));
    }),
);

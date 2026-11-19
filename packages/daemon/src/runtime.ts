import { Agent } from '@sedge-hq/agent';
import { Inbox, Timers, type InboxItem } from '@sedge-hq/db';
import { type AgentEvent, type AgentRunError, Completion } from '@sedge-hq/protocol';
import { Context, Cron, type Duration, Effect, Layer, PubSub, Queue, Ref, Result } from 'effect';
import { supervise } from './supervise';

/** One message on the daemon's internal bus, for the inbox events it concerns. */
export type BusMessage =
    | {
          readonly _tag: 'Event';
          readonly itemIds: ReadonlyArray<string>;
          readonly event: AgentEvent;
      }
    | { readonly _tag: 'Failed'; readonly itemIds: ReadonlyArray<string>; readonly message: string }
    | {
          readonly _tag: 'Completed';
          readonly itemIds: ReadonlyArray<string>;
          readonly completion: Completion;
      };

/** Wakes the inbox worker after an enqueue, instead of leaving it to its next poll. */
export class WorkerWake extends Context.Service<
    WorkerWake,
    {
        readonly wake: Effect.Effect<void>;
        /** Waits for a wake-up, or `timeout` at most. */
        readonly wait: (timeout: Duration.Input) => Effect.Effect<void>;
    }
>()('sedge/daemon/WorkerWake') {
    static readonly layer = Layer.effect(
        WorkerWake,
        Effect.gen(function* () {
            const wakeups = yield* Queue.sliding<void>(1);
            return WorkerWake.of({
                wake: Queue.offer(wakeups, undefined).pipe(Effect.asVoid),
                wait: (timeout) =>
                    Queue.take(wakeups).pipe(Effect.timeoutOption(timeout), Effect.asVoid),
            });
        }),
    );
}

const time = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A batch becomes one prompt. A single terminal task stays as typed; anything else is labelled
 * with where and when it came from, so the agent can tell a timer from a chat message.
 */
export const formatBatch = (items: ReadonlyArray<InboxItem>): string => {
    const [only] = items;
    if (items.length === 1 && only?.source === 'cli') return only.prompt;
    const lines = items.map((item) => `[${item.source} · ${time(item.createdAt)}] ${item.prompt}`);
    return items.length === 1
        ? lines[0]!
        : `${items.length} new events since your last run:\n\n${lines.join('\n\n')}`;
};

/**
 * The always-on loop. One worker drains the inbox a thread's batch at a time, so runs never
 * compete for a session; the scheduler turns due timers into inbox events. Both are supervised:
 * a failure that keeps happening backs off instead of spinning.
 */
export class Runtime extends Context.Service<
    Runtime,
    {
        readonly bus: PubSub.PubSub<BusMessage>;
        /** The thread a run is in progress for, if any. */
        readonly running: Effect.Effect<string | null>;
    }
>()('sedge/daemon/Runtime') {
    static readonly layer = Layer.effect(
        Runtime,
        Effect.gen(function* () {
            const inbox = yield* Inbox;
            const timers = yield* Timers;
            const agent = yield* Agent;
            const worker = yield* WorkerWake;
            const bus = yield* PubSub.unbounded<BusMessage>();
            const running = yield* Ref.make<string | null>(null);
            const publish = (message: BusMessage) => PubSub.publish(bus, message);

            const recovered = yield* inbox.recoverInterrupted;
            if (recovered > 0) {
                yield* Effect.logWarning(`Requeued ${recovered} interrupted event(s)`);
            }

            const processNext = Effect.gen(function* () {
                const batch = yield* inbox.claimBatch;
                const first = batch[0];
                if (!first) return false;
                const itemIds = batch.map((item) => item.id);
                yield* Ref.set(running, first.thread);
                for (const itemId of itemIds) {
                    yield* publish({ _tag: 'Event', itemIds, event: { _tag: 'Started', itemId } });
                }

                const outcome = yield* agent
                    .run(
                        {
                            thread: first.thread,
                            sources: [...new Set(batch.map((item) => item.source))],
                            cwd: batch[batch.length - 1]!.cwd,
                            prompt: formatBatch(batch),
                        },
                        (event) => publish({ _tag: 'Event', itemIds, event }),
                    )
                    .pipe(
                        Effect.map((text) => ({ ok: true as const, text })),
                        Effect.catch((error: AgentRunError) =>
                            Effect.succeed({ ok: false as const, text: error.message }),
                        ),
                        Effect.ensuring(Ref.set(running, null)),
                    );

                yield* inbox.finish(
                    itemIds,
                    outcome.ok ? { result: outcome.text } : { error: outcome.text },
                );
                if (outcome.ok) {
                    for (const itemId of itemIds) {
                        yield* publish({
                            _tag: 'Event',
                            itemIds: [itemId],
                            event: { _tag: 'Finished', itemId, text: outcome.text },
                        });
                    }
                } else {
                    yield* publish({ _tag: 'Failed', itemIds, message: outcome.text });
                    yield* Effect.logError(`Run for ${first.thread} failed: ${outcome.text}`);
                }
                for (const item of batch) {
                    yield* publish({
                        _tag: 'Completed',
                        itemIds: [item.id],
                        completion: new Completion({
                            itemId: item.id,
                            source: item.source,
                            prompt: item.prompt,
                            ok: outcome.ok,
                            text: outcome.text,
                        }),
                    });
                }
                return true;
            });

            // Drain everything pending, then sleep until woken or the next poll.
            const drain = Effect.gen(function* () {
                while (yield* processNext) {}
                yield* worker.wait('5 seconds');
            });

            const tick = Effect.gen(function* () {
                const now = Date.now();
                for (const timer of yield* timers.due(now)) {
                    let next: number | undefined;
                    if (timer.kind === 'schedule') {
                        const cron = Cron.parse(timer.cron ?? '');
                        if (Result.isFailure(cron)) {
                            yield* Effect.logError(
                                `Timer ${timer.id} has an invalid cron: ${timer.cron}`,
                            );
                            yield* timers.cancel(timer.id);
                            continue;
                        }
                        next = Cron.next(cron.success, new Date(now)).getTime();
                    }
                    // The firing's due time makes the event id: a crash before markFired fires
                    // the timer again, and the inbox drops the duplicate.
                    yield* inbox.enqueue({
                        source: 'timer',
                        externalId: `${timer.id}@${timer.nextRunAt}`,
                        thread: timer.thread,
                        prompt: timer.name ? `${timer.name}: ${timer.prompt}` : timer.prompt,
                        cwd: timer.cwd,
                    });
                    yield* timers.markFired(timer, now, next);
                }
                yield* worker.wake;
                yield* Effect.sleep('15 seconds');
            });

            yield* Effect.forkScoped(supervise('Inbox worker', drain));
            yield* Effect.forkScoped(supervise('Scheduler', tick));

            return Runtime.of({ bus, running: Ref.get(running) });
        }),
    );
}

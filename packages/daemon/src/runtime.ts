import { Agent } from '@sedge-hq/agent';
import { Inbox, Timers, type InboxItem } from '@sedge-hq/db';
import { type AgentEvent, type AgentRunError, Completion } from '@sedge-hq/protocol';
import {
    Context,
    Cron,
    Fiber,
    type Duration,
    Effect,
    Layer,
    PubSub,
    Queue,
    Ref,
    Result,
    Schedule,
} from 'effect';
import { Connections } from './connections';
import { DREAM_PROMPT } from './memory';
import { Settings } from './settings';
import { supervise } from './supervise';

/** The conversation dreaming happens in, apart from the user's. */
export const DREAM_THREAD = 'dream';
const DREAM_CRON = '30 3 * * *';

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
    new Date(ms).toLocaleString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });

/**
 * What the agent reads for an event. A terminal task stays as typed; anything else is labelled
 * with where and when it came from, so the agent can tell a timer from a chat message. The time
 * lives here rather than in the system prompt, which would otherwise change every run.
 */
export const formatItem = (item: InboxItem): string =>
    item.source === 'cli'
        ? item.prompt
        : `[${item.source} · ${time(item.createdAt)}] ${item.prompt}`;

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
            const connections = yield* Connections;
            const bus = yield* PubSub.unbounded<BusMessage>();
            const running = yield* Ref.make<string | null>(null);
            const publish = (message: BusMessage) => PubSub.publish(bus, message);

            // Dreaming: once a night the agent reads back over its recent conversations and tidies
            // its memory. `"dreaming": false` in the config turns it off.
            const { paths, config } = yield* Settings;
            const dreams = (yield* timers.list(DREAM_THREAD)).filter((t) => t.name === 'dream');
            if (config.dreaming === false) {
                for (const dream of dreams) yield* timers.cancel(dream.id);
            } else if (dreams.length === 0) {
                const cron = Cron.parse(DREAM_CRON);
                if (Result.isSuccess(cron)) {
                    yield* timers.create({
                        kind: 'schedule',
                        thread: DREAM_THREAD,
                        name: 'dream',
                        cron: DREAM_CRON,
                        prompt: DREAM_PROMPT,
                        cwd: paths.memory,
                        nextRunAt: Cron.next(cron.success, new Date()).getTime(),
                    });
                }
            }

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

                // "typing…" on the user's channel while the run lasts.
                const typing = yield* Effect.forkChild(
                    connections
                        .working(first.thread)
                        .pipe(Effect.repeat(Schedule.spaced('4 seconds'))),
                );
                const outcome = yield* agent
                    .run(
                        {
                            thread: first.thread,
                            sources: [...new Set(batch.map((item) => item.source))],
                            cwd: batch[batch.length - 1]!.cwd,
                            items: batch.map((item) => ({ id: item.id, text: formatItem(item) })),
                        },
                        (event) => publish({ _tag: 'Event', itemIds, event }),
                    )
                    .pipe(
                        Effect.ensuring(Fiber.interrupt(typing)),
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

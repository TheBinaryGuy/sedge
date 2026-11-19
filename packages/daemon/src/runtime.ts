import { Agent } from '@repo/agent';
import { Inbox, Timers } from '@repo/db';
import type { AgentRunError } from '@repo/protocol';
import { Completion, type AgentEvent } from '@repo/protocol';
import { Context, Cron, Effect, Layer, PubSub, Queue, Ref, Result, Schedule } from 'effect';

/** One message on the daemon's internal bus, scoped to the inbox item it belongs to. */
export type BusMessage =
    | { readonly _tag: 'Event'; readonly itemId: string; readonly event: AgentEvent }
    | { readonly _tag: 'Failed'; readonly itemId: string; readonly message: string }
    | { readonly _tag: 'Completed'; readonly itemId: string; readonly completion: Completion };

/**
 * The always-on part: one worker that drains the inbox into pi, a ticker that turns due timers
 * into inbox items, and a bus that lets any connected client watch a run. The worker is the only
 * place a run starts, so two runs never touch the same pi session at once.
 */
export class Runtime extends Context.Service<
    Runtime,
    {
        readonly bus: PubSub.PubSub<BusMessage>;
        /** Nudges the worker after an enqueue instead of waiting for its next poll. */
        readonly wake: Effect.Effect<void>;
        readonly running: Effect.Effect<string | null>;
    }
>()('sedge/daemon/Runtime') {
    static readonly layer = Layer.effect(
        Runtime,
        Effect.gen(function* () {
            const inbox = yield* Inbox;
            const timers = yield* Timers;
            const agent = yield* Agent;
            const bus = yield* PubSub.unbounded<BusMessage>();
            const wakeups = yield* Queue.sliding<void>(1);
            const running = yield* Ref.make<string | null>(null);

            const recovered = yield* inbox.recoverInterrupted;
            if (recovered > 0)
                yield* Effect.logWarning(`Requeued ${recovered} interrupted item(s)`);

            const publish = (message: BusMessage) => PubSub.publish(bus, message);

            const processNext = Effect.gen(function* () {
                const item = yield* inbox.claimNext;
                if (!item) return false;
                yield* Ref.set(running, item.id);
                yield* publish({
                    _tag: 'Event',
                    itemId: item.id,
                    event: { _tag: 'Started', itemId: item.id },
                });
                yield* agent
                    .run({ prompt: item.prompt, cwd: item.cwd }, (event) =>
                        publish({ _tag: 'Event', itemId: item.id, event }),
                    )
                    .pipe(
                        Effect.matchEffect({
                            onSuccess: (text) =>
                                inbox.finish(item.id, { result: text }).pipe(
                                    Effect.andThen(
                                        publish({
                                            _tag: 'Event',
                                            itemId: item.id,
                                            event: { _tag: 'Finished', itemId: item.id, text },
                                        }),
                                    ),
                                ),
                            onFailure: (error: AgentRunError) =>
                                inbox.finish(item.id, { error: error.message }).pipe(
                                    Effect.andThen(
                                        publish({
                                            _tag: 'Failed',
                                            itemId: item.id,
                                            message: error.message,
                                        }),
                                    ),
                                    Effect.andThen(
                                        Effect.logError(`Run ${item.id} failed: ${error.message}`),
                                    ),
                                ),
                        }),
                        Effect.exit,
                    );
                const finished = yield* inbox.get(item.id);
                yield* publish({
                    _tag: 'Completed',
                    itemId: item.id,
                    completion: new Completion({
                        itemId: item.id,
                        source: item.source,
                        prompt: item.prompt,
                        ok: finished?.status === 'done',
                        text: finished?.result ?? finished?.error ?? '',
                    }),
                });
                yield* Ref.set(running, null);
                return true;
            });

            // Drain everything pending, then sleep until woken or the next poll.
            const worker = Effect.gen(function* () {
                while (yield* processNext) {}
                yield* Queue.take(wakeups).pipe(Effect.timeoutOption('5 seconds'));
            }).pipe(
                Effect.catchCause((cause) =>
                    Effect.logError('Inbox worker crashed; restarting', cause),
                ),
                Effect.forever,
            );

            const tickTimers = Effect.gen(function* () {
                const now = Date.now();
                for (const timer of yield* timers.due(now)) {
                    const cron = Cron.parse(timer.cron);
                    if (Result.isFailure(cron)) {
                        yield* Effect.logError(
                            `Timer ${timer.name} has an invalid cron: ${timer.cron}`,
                        );
                        continue;
                    }
                    yield* inbox.enqueue({ source: 'timer', prompt: timer.prompt, cwd: timer.cwd });
                    yield* timers.markRan(
                        timer.id,
                        now,
                        Cron.next(cron.success, new Date(now)).getTime(),
                    );
                }
                yield* Queue.offer(wakeups, undefined);
            }).pipe(Effect.repeat(Schedule.spaced('15 seconds')));

            yield* Effect.forkScoped(worker);
            yield* Effect.forkScoped(tickTimers);

            return Runtime.of({
                bus,
                wake: Queue.offer(wakeups, undefined).pipe(Effect.asVoid),
                running: Ref.get(running),
            });
        }),
    );
}

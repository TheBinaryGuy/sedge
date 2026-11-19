import { BunSocketServer } from '@effect/platform-bun';
import { Agent } from '@sedge-hq/agent';
import { type SedgePaths, VERSION } from '@sedge-hq/core';
import { Inbox, Timers } from '@sedge-hq/db';
import type { DaemonInfo } from '@sedge-hq/protocol';
import { AgentRunError, DaemonStatus, SedgeRpcs, UpdateInfo } from '@sedge-hq/protocol';
import { Context, Deferred, Effect, Layer, PubSub, Ref, Result, Stream } from 'effect';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import { Runtime, WorkerWake } from './runtime';
import { Sources } from './sources';
import { Updater } from './updater';

export interface ShutdownRequest {
    readonly restart: boolean;
}

/** Lifecycle state the handlers share with the process that started the daemon. */
export class DaemonControl extends Context.Service<
    DaemonControl,
    {
        readonly info: DaemonInfo;
        readonly shutdown: Deferred.Deferred<ShutdownRequest>;
        /** A version the updater installed that will run after the next restart. */
        readonly pendingUpdate: Ref.Ref<string | null>;
    }
>()('sedge/daemon/DaemonControl') {}

const HandlersLive = SedgeRpcs.toLayer(
    Effect.gen(function* () {
        const control = yield* DaemonControl;
        const runtime = yield* Runtime;
        const inbox = yield* Inbox;
        const timers = yield* Timers;
        const agent = yield* Agent;
        const updater = yield* Updater;
        const worker = yield* WorkerWake;
        const sources = yield* Sources;

        return SedgeRpcs.of({
            Hello: () => Effect.succeed(control.info),

            Status: () =>
                Effect.gen(function* () {
                    return new DaemonStatus({
                        info: control.info,
                        running: yield* runtime.running,
                        pending: yield* inbox.pendingCount,
                        timers: yield* timers.count,
                        update: yield* Ref.get(control.pendingUpdate),
                    });
                }),

            // Subscribe before enqueueing so not even the first event of a fast run is missed.
            Prompt: ({ text, cwd }) =>
                Stream.unwrap(
                    Effect.gen(function* () {
                        const subscription = yield* PubSub.subscribe(runtime.bus);
                        const item = yield* inbox.enqueue({
                            source: 'cli',
                            thread: `cli:${cwd}`,
                            prompt: text,
                            cwd,
                        });
                        if (!item) return yield* new AgentRunError({ message: 'Not queued' });
                        const ahead =
                            (yield* inbox.pendingCount) - 1 + ((yield* runtime.running) ? 1 : 0);
                        yield* worker.wake;
                        return Stream.make({
                            _tag: 'Queued' as const,
                            itemId: item.id,
                            ahead,
                        }).pipe(
                            Stream.concat(
                                Stream.fromSubscription(subscription).pipe(
                                    Stream.filter(
                                        (message) =>
                                            message.itemIds.includes(item.id) &&
                                            message._tag !== 'Completed',
                                    ),
                                    Stream.mapEffect((message) =>
                                        message._tag === 'Failed'
                                            ? Effect.fail(
                                                  new AgentRunError({ message: message.message }),
                                              )
                                            : message._tag === 'Event'
                                              ? Effect.succeed(message.event)
                                              : Effect.die('unreachable'),
                                    ),
                                    Stream.takeUntil((event) => event._tag === 'Finished'),
                                ),
                            ),
                        );
                    }),
                ),

            Abort: () => agent.abort,

            Watch: () =>
                Stream.unwrap(
                    PubSub.subscribe(runtime.bus).pipe(
                        Effect.map((subscription) =>
                            Stream.fromSubscription(subscription).pipe(
                                Stream.filterMap((message) =>
                                    message._tag === 'Completed'
                                        ? Result.succeed(message.completion)
                                        : Result.failVoid,
                                ),
                            ),
                        ),
                    ),
                ),

            CheckUpdate: ({ apply }) =>
                Effect.gen(function* () {
                    const latest = yield* updater.check.pipe(
                        Effect.catch((error) =>
                            Effect.logWarning(`Update check failed: ${error.message}`).pipe(
                                Effect.as(null),
                            ),
                        ),
                    );
                    let applied = false;
                    if (apply && latest) {
                        applied = yield* updater.apply(latest).pipe(
                            Effect.as(true),
                            Effect.catch((error) =>
                                Effect.logError(`Update failed: ${error.message}`).pipe(
                                    Effect.as(false),
                                ),
                            ),
                        );
                        if (applied) yield* Ref.set(control.pendingUpdate, latest);
                    }
                    return new UpdateInfo({
                        current: VERSION,
                        latest,
                        installMethod: updater.installMethod,
                        applied,
                    });
                }),

            Sources: () => sources.list,
            SourceTypes: () => sources.types,
            PlanSource: ({ type, options }) => sources.plan(type, options),
            AddSource: (input) => sources.add(input),
            RemoveSource: ({ name }) => sources.remove(name),
            AddSourceType: ({ name, code }) => sources.addType(name, code),
            ReloadSourceTypes: () => sources.reloadTypes,
            Questions: () => sources.questions,
            Answer: ({ id, answer }) => sources.answer(id, answer),

            // Answer first, then stop: the reply must leave before the socket closes.
            Shutdown: ({ restart }) =>
                Deferred.succeed(control.shutdown, { restart }).pipe(
                    Effect.delay('50 millis'),
                    Effect.forkDetach,
                    Effect.asVoid,
                ),
        });
    }),
);

export const ServerLive = (paths: SedgePaths) =>
    RpcServer.layer(SedgeRpcs).pipe(
        Layer.provide(HandlersLive),
        Layer.provide(RpcServer.layerProtocolSocketServer),
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(BunSocketServer.layer({ path: paths.socket })),
    );

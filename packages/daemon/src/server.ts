import { BunSocketServer } from '@effect/platform-bun';
import { Agent } from '@sedge-hq/agent';
import { type SedgePaths, VERSION } from '@sedge-hq/core';
import { Inbox, Outbox, Timers } from '@sedge-hq/db';
import type { DaemonInfo } from '@sedge-hq/protocol';
import {
    AgentError,
    AgentInfo,
    AgentRunError,
    DaemonStatus,
    InboxEntry,
    OutboxEntry,
    SedgeRpcs,
    TimerInfo,
    UpdateInfo,
} from '@sedge-hq/protocol';
import { Context, Deferred, Effect, Layer, PubSub, Ref, Result, Stream } from 'effect';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import { Runtime, WorkerWake } from './runtime';
import { Agents } from './agents';
import { Connections } from './connections';
import { threadOf } from './threads';
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
        const connections = yield* Connections;
        const agents = yield* Agents;
        const outbox = yield* Outbox;

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
            Prompt: ({ text, cwd, agent }) =>
                Stream.unwrap(
                    Effect.gen(function* () {
                        const subscription = yield* PubSub.subscribe(runtime.bus);
                        const item = yield* inbox.enqueue({
                            source: 'cli',
                            thread: agent ? threadOf(agent) : `cli:${cwd}`,
                            prompt: text,
                            cwd,
                        });
                        if (!item) return yield* new AgentRunError({ message: 'Not queued' });
                        const ahead =
                            (yield* inbox.pendingCount) - 1 + (yield* runtime.running).length;
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

            Agents: () =>
                Effect.gen(function* () {
                    const running = new Set(yield* runtime.running);
                    const pending = yield* inbox.pendingByThread;
                    return (yield* agents.list).map(
                        (agent) =>
                            new AgentInfo({
                                name: agent.name,
                                purpose: agent.purpose,
                                connections: [...agent.connections],
                                memory: agent.memory,
                                running: running.has(threadOf(agent.name)),
                                pending: pending[threadOf(agent.name)] ?? 0,
                            }),
                    );
                }),
            SaveAgent: ({ name, purpose, connections: owned }) =>
                agents.save({ name, purpose, connections: owned ?? undefined }).pipe(
                    Effect.map(
                        (agent) =>
                            new AgentInfo({
                                name: agent.name,
                                purpose: agent.purpose,
                                connections: [...agent.connections],
                                memory: agent.memory,
                                running: false,
                                pending: 0,
                            }),
                    ),
                    Effect.mapError((error) => new AgentError({ message: error.message })),
                ),
            RemoveAgent: ({ name }) =>
                agents
                    .remove(name)
                    .pipe(Effect.mapError((error) => new AgentError({ message: error.message }))),
            Inbox: ({ agent, limit }) =>
                inbox.list({ thread: agent ? threadOf(agent) : undefined, limit }).pipe(
                    Effect.map((items) =>
                        items.map(
                            (item) =>
                                new InboxEntry({
                                    id: item.id,
                                    thread: item.thread,
                                    source: item.source,
                                    prompt: item.prompt,
                                    status: item.status,
                                    createdAt: item.createdAt,
                                    finishedAt: item.finishedAt ?? null,
                                    error: item.error ?? null,
                                }),
                        ),
                    ),
                ),
            Outbox: ({ agent, limit }) =>
                outbox.list({ thread: agent ? threadOf(agent) : undefined, limit }).pipe(
                    Effect.map((messages) =>
                        messages.map(
                            (message) =>
                                new OutboxEntry({
                                    id: message.id,
                                    thread: message.thread,
                                    kind: message.kind,
                                    text: message.text,
                                    status: message.status,
                                    attempts: message.attempts,
                                    createdAt: message.createdAt,
                                    sentAt: message.sentAt ?? null,
                                    error: message.error ?? null,
                                }),
                        ),
                    ),
                ),
            Timers: ({ agent }) =>
                timers.list(agent ? threadOf(agent) : undefined).pipe(
                    Effect.map((active) =>
                        active.map(
                            (timer) =>
                                new TimerInfo({
                                    id: timer.id,
                                    thread: timer.thread,
                                    name: timer.name ?? null,
                                    kind: timer.kind,
                                    cron: timer.cron ?? null,
                                    prompt: timer.prompt,
                                    nextRunAt: timer.nextRunAt,
                                }),
                        ),
                    ),
                ),
            Connections: () => connections.list,
            Kinds: () => connections.kinds,
            CheckSettings: ({ kind, settings }) => connections.check(kind, settings),
            Connect: (input) => connections.connect(input),
            Disconnect: ({ name }) => connections.disconnect(name),
            Invite: ({ name }) => connections.invite(name),
            AddKind: ({ name, code }) => connections.addKind(name, code),
            ReloadKinds: () => connections.reloadKinds,

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

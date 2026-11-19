import { BunSocket } from '@effect/platform-bun';
import { isDevBuild, type SedgePaths, VERSION } from '@repo/core';
import { spawnDetachedDaemon } from '@repo/daemon';
import { type DaemonInfo, PROTOCOL, SedgeRpcs } from '@repo/protocol';
import { Context, Effect, Layer, Schema } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { createConnection } from 'node:net';

export class DaemonUnavailable extends Schema.TaggedError<DaemonUnavailable>()(
    'DaemonUnavailable',
    {
        message: Schema.String,
    },
) {}

/** True when something is accepting connections on the daemon's socket right now. */
export const isListening = (paths: SedgePaths) =>
    Effect.callback<boolean>((resume) => {
        const socket = createConnection({ path: paths.socket });
        const done = (alive: boolean) => resume(Effect.succeed(alive));
        // A graceful close, so the daemon doesn't log every probe as a reset connection.
        socket.once('connect', () => {
            socket.end();
            done(true);
        });
        socket.once('error', () => {
            socket.destroy();
            done(false);
        });
        return Effect.sync(() => socket.destroy());
    });

const waitUntil = (paths: SedgePaths, listening: boolean) =>
    Effect.gen(function* () {
        for (let i = 0; i < 100; i++) {
            if ((yield* isListening(paths)) === listening) return true;
            yield* Effect.sleep('100 millis');
        }
        return false;
    });

const makeClient = RpcClient.make(SedgeRpcs);
export type Client = Effect.Success<typeof makeClient>;

export class Daemon extends Context.Service<
    Daemon,
    { readonly client: Client; readonly info: DaemonInfo }
>()('sedge/cli/Daemon') {}

/** The socket lives as long as the caller's scope, not just until the client is built. */
const connect = (paths: SedgePaths) =>
    Effect.gen(function* () {
        const protocol = yield* Layer.build(
            RpcClient.layerProtocolSocket().pipe(
                Layer.provide(RpcSerialization.layerNdjson),
                Layer.provide(BunSocket.layerNet({ path: paths.socket })),
            ),
        );
        return yield* makeClient.pipe(Effect.provideContext(protocol));
    });

/**
 * The client never runs the agent itself: it finds the daemon, or starts one and waits for its
 * socket. A daemon from another version (the binary was updated underneath it) is replaced, so
 * the client and daemon always speak the same protocol.
 */
export const DaemonLive = (
    paths: SedgePaths,
    options: { readonly autostart: boolean } = { autostart: true },
) =>
    Layer.effect(
        Daemon,
        Effect.gen(function* () {
            if (!(yield* isListening(paths))) {
                if (!options.autostart) {
                    return yield* new DaemonUnavailable({ message: 'The daemon is not running.' });
                }
                yield* spawnDetachedDaemon(paths);
                if (!(yield* waitUntil(paths, true))) {
                    return yield* new DaemonUnavailable({
                        message: `The daemon did not start; see ${paths.logs}/daemon.log`,
                    });
                }
            }

            let client = yield* connect(paths);
            let info = yield* client.Hello();

            if ((info.version !== VERSION && !isDevBuild) || info.protocol !== PROTOCOL) {
                yield* client.Shutdown({ restart: false });
                yield* spawnDetachedDaemon(paths, { SEDGE_REPLACES_PID: String(info.pid) });
                yield* waitUntil(paths, false);
                if (!(yield* waitUntil(paths, true))) {
                    return yield* new DaemonUnavailable({ message: 'The daemon did not restart.' });
                }
                client = yield* connect(paths);
                info = yield* client.Hello();
            }

            return Daemon.of({ client, info });
        }).pipe(
            Effect.catchTag('RpcClientError', (error) =>
                Effect.fail(new DaemonUnavailable({ message: error.message })),
            ),
        ),
    );

export { waitUntil };

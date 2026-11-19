import { BunRuntime, BunServices } from '@effect/platform-bun';
import { sedgePaths, VERSION } from '@repo/core';
import { installService, runDaemon, spawnDetachedDaemon, uninstallService } from '@repo/daemon';
import { Console, Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import { Daemon, DaemonLive, isListening, waitUntil } from './client';
import { loadPi } from './load-pi';

const paths = sedgePaths();

/** Runs `use` with a connected daemon; the connection closes when `use` finishes. */
const withDaemon = <A, E, R>(
    use: (daemon: Daemon['Service']) => Effect.Effect<A, E, R>,
    options: { readonly autostart: boolean } = { autostart: true },
) =>
    Effect.gen(function* () {
        return yield* use(yield* Daemon);
    }).pipe(Effect.provide(DaemonLive(paths, options)));

const sedge = Command.make('sedge').pipe(
    Command.withDescription('An always-on agent that lives on your machine.'),
);

/** `sedge start`: make sure the daemon is running. `--foreground` is the daemon itself. */
const start = Command.make(
    'start',
    {
        foreground: Flag.Boolean('foreground').pipe(
            Flag.withDescription('Run the daemon in this process instead of in the background'),
            Flag.withDefault(false),
        ),
        service: Flag.Boolean('service').pipe(
            Flag.withDescription('Also start it at login (launchd on macOS, systemd on Linux)'),
            Flag.withDefault(false),
        ),
    },
    Effect.fn(function* ({ foreground, service }) {
        if (service) {
            if (yield* isListening(paths)) {
                yield* withDaemon(({ client }) => client.Shutdown({ restart: false }), {
                    autostart: false,
                });
                yield* waitUntil(paths, false);
            }
            const file = yield* installService(paths);
            yield* waitUntil(paths, true);
            return yield* Console.log(`Installed ${file}; sedge now starts at login.`);
        }
        if (!foreground) {
            return yield* withDaemon(({ info }) =>
                Console.log(`sedge ${info.version} running (pid ${info.pid}) on ${paths.socket}`),
            );
        }
        const restart = yield* runDaemon(paths, { loadPi }).pipe(
            Effect.catchTag('DaemonAlreadyRunning', (error) =>
                Effect.fail(new Error(`Another daemon is already running (pid ${error.pid}).`)),
            ),
        );
        // Under launchd/systemd the supervisor relaunches us; otherwise we hand over ourselves.
        if (restart && !process.env.SEDGE_SUPERVISED) {
            yield* spawnDetachedDaemon(paths, { SEDGE_REPLACES_PID: String(process.pid) });
        }
        // Everything is closed by now, but pi's MCP connections and HTTP agents can hold the
        // event loop open; a daemon that said "Stopping" must actually be gone.
        return yield* Effect.sync(() => process.exit(0));
    }),
).pipe(Command.withDescription('Start the background daemon'));

const stop = Command.make(
    'stop',
    {},
    Effect.fn(function* () {
        yield* uninstallService;
        if (!(yield* isListening(paths))) return yield* Console.log('The daemon is not running.');
        yield* withDaemon(({ client }) => client.Shutdown({ restart: false }), {
            autostart: false,
        });
        yield* waitUntil(paths, false);
        yield* Console.log('Stopped.');
    }),
).pipe(
    Command.withDescription('Stop the daemon after its current run (and remove the login service)'),
);

const update = Command.make(
    'update',
    {
        check: Flag.Boolean('check').pipe(
            Flag.withDescription('Only report whether an update is available'),
            Flag.withDefault(false),
        ),
    },
    Effect.fn(function* ({ check }) {
        const info = yield* withDaemon(({ client }) => client.CheckUpdate({ apply: !check }));
        if (!info.latest)
            return yield* Console.log(
                `sedge ${info.current} is up to date (${info.installMethod}).`,
            );
        if (check)
            return yield* Console.log(
                `sedge ${info.latest} is available (you have ${info.current}).`,
            );
        if (!info.applied)
            return yield* Console.log(`Could not install ${info.latest}; see the daemon log.`);
        yield* withDaemon(({ client }) => client.Shutdown({ restart: true }));
        yield* Console.log(`Updated to ${info.latest}. The daemon restarts once it is idle.`);
    }),
).pipe(Command.withDescription('Update sedge to the latest release'));

/** `sedge start|stop|update`, parsed and run by Effect's CLI. */
export const runSedgeCommand = () =>
    sedge.pipe(
        Command.withSubcommands([start, stop, update]),
        Command.run({ version: VERSION }),
        Effect.provide(BunServices.layer),
        BunRuntime.runMain,
    );

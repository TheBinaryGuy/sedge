import { BunRuntime, BunServices } from '@effect/platform-bun';
import { sedgePaths, VERSION } from '@sedge-hq/core';
import { installService, runDaemon, spawnDetachedDaemon, uninstallService } from '@sedge-hq/daemon';
import { Console, Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Daemon, DaemonLive, isListening, waitUntil } from './client';
import { loadPi } from './load-pi';
import { packageSpec } from './source-tools';

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

/**
 * A package folder (one you're writing, or one inside a monorepo) is packed first, the way it would
 * be published: `workspace:` references become versions, and only its published files go in.
 * Installing the folder directly would try to resolve those workspace references and fail.
 */
const localPackage = async (name: string): Promise<string | undefined> => {
    const dir = resolve(name);
    const isPackage = await stat(join(dir, 'package.json')).then(
        (s) => s.isFile(),
        () => false,
    );
    if (!isPackage) return undefined;
    const destination = await mkdtemp(join(tmpdir(), 'sedge-pack-'));
    const proc = Bun.spawn(
        [process.execPath, 'pm', 'pack', '--destination', destination, '--quiet'],
        {
            cwd: dir,
            env: { ...process.env, BUN_BE_BUN: '1' },
            stdout: 'pipe',
            stderr: 'inherit',
        },
    );
    const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    if (code !== 0) throw new Error(`Could not pack ${dir}`);
    return resolve(destination, out.trim().split('\n').pop()!);
};

/**
 * `sedge install telegram`: adds a package of source types to ~/.sedge/packages, a small npm
 * project of its own. The binary installs it by running as Bun (`BUN_BE_BUN`), so neither npm nor
 * Bun has to be on the machine. A running daemon picks the new types up straight away.
 */
const install = Command.make(
    'install',
    {
        name: Argument.String('package').pipe(
            Argument.withDescription('A source package: "telegram", a full npm name, or a path'),
        ),
    },
    Effect.fn(function* ({ name }) {
        const spec = yield* Effect.promise(() => localPackage(name)).pipe(
            Effect.map((packed) => packed ?? packageSpec(name)),
        );
        const manifest = join(paths.packages, 'package.json');
        yield* Effect.promise(async () => {
            await mkdir(paths.packages, { recursive: true });
            await readFile(manifest).catch(() =>
                writeFile(
                    manifest,
                    `${JSON.stringify({ name: 'sedge-packages', private: true }, null, 4)}\n`,
                ),
            );
        });
        const code = yield* Effect.promise(async () => {
            const proc = Bun.spawn([process.execPath, 'add', spec], {
                cwd: paths.packages,
                env: { ...process.env, BUN_BE_BUN: '1' },
                stdout: 'ignore',
                stderr: 'inherit',
            });
            return proc.exited;
        });
        if (code !== 0) return yield* Effect.fail(new Error(`Could not install ${spec}`));
        if (yield* isListening(paths)) {
            const types = yield* withDaemon(({ client }) =>
                client.ReloadSourceTypes().pipe(Effect.andThen(client.SourceTypes())),
            );
            return yield* Console.log(
                `Installed ${spec}. Source types: ${types.map((t) => t.name).join(', ')}`,
            );
        }
        yield* Console.log(`Installed ${spec}.`);
    }),
).pipe(Command.withDescription('Install a package of event sources (e.g. telegram)'));

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
        Command.withSubcommands([start, stop, update, install]),
        Command.run({ version: VERSION }),
        Effect.provide(BunServices.layer),
        BunRuntime.runMain,
    );

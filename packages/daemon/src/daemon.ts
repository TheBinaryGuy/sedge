import { Agent, type AgentConfig, defaultAgentConfig } from '@sedge-hq/agent';
import { isDevBuild, loadConfig, selfCommand, type SedgePaths, VERSION } from '@sedge-hq/core';
import { Inbox, StoresLive } from '@sedge-hq/db';
import { DaemonInfo, PROTOCOL } from '@sedge-hq/protocol';
import { Deferred, Duration, Effect, Layer, Ref, Schedule } from 'effect';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireDaemonLock, waitForExit } from './lock';
import { Connections } from './connections';
import { DispatcherLive } from './dispatcher';
import { makeHost } from './host';
import { ensureMemory } from './memory';
import { Runtime, WorkerWake } from './runtime';
import { DaemonControl, ServerLive, type ShutdownRequest } from './server';
import { Settings } from './settings';
import { Updater } from './updater';

const UPDATE_INTERVAL = Duration.hours(6);

/**
 * Checks the registry on start and every six hours. A newer version is installed straight away
 * but only takes over once the agent is idle, so an update never cuts a run short. Set
 * `SEDGE_NO_UPDATE=1` to only report updates.
 */
const autoUpdate = Effect.gen(function* () {
    const updater = yield* Updater;
    const control = yield* DaemonControl;
    const runtime = yield* Runtime;
    const inbox = yield* Inbox;
    const enabled = !process.env.SEDGE_NO_UPDATE;

    const once = Effect.gen(function* () {
        if (yield* Ref.get(control.pendingUpdate)) return;
        const latest = yield* updater.check;
        if (!latest) return;
        if (!enabled) return yield* Effect.logInfo(`sedge ${latest} is available`);
        yield* Effect.logInfo(`Updating sedge ${VERSION} → ${latest}`);
        yield* updater.apply(latest);
        yield* Ref.set(control.pendingUpdate, latest);
        while ((yield* runtime.running) !== null || (yield* inbox.pendingCount) > 0) {
            yield* Effect.sleep('5 seconds');
        }
        yield* Deferred.succeed(control.shutdown, { restart: true });
    }).pipe(Effect.catch((error) => Effect.logWarning(`Update check failed: ${error.message}`)));

    yield* once.pipe(Effect.delay('30 seconds'), Effect.repeat(Schedule.spaced(UPDATE_INTERVAL)));
});

/**
 * Runs the daemon until a client asks it to stop (or the process gets SIGINT/SIGTERM), then
 * releases everything in reverse order: socket, worker, pi sessions, database, lock. Returns
 * whether it should be relaunched, which the caller does after this scope has closed.
 */
export const runDaemon = (
    paths: SedgePaths,
    options: { readonly loadPi?: AgentConfig['loadPi'] } = {},
) =>
    Effect.gen(function* () {
        const replaces = Number.parseInt(process.env.SEDGE_REPLACES_PID ?? '', 10);
        if (replaces) yield* waitForExit(replaces);

        // Under launchd/systemd, exiting just gets us relaunched into the same conflict, so a
        // supervised daemon waits for the lock instead of giving up.
        yield* acquireDaemonLock(paths).pipe(
            process.env.SEDGE_SUPERVISED
                ? Effect.retry({
                      while: (e) => e._tag === 'DaemonAlreadyRunning',
                      schedule: Schedule.spaced('2 seconds'),
                  })
                : (self) => self,
        );

        const shutdown = yield* Deferred.make<ShutdownRequest>();
        const control = DaemonControl.of({
            info: new DaemonInfo({
                version: VERSION,
                pid: process.pid,
                startedAt: Date.now(),
                home: paths.home,
                protocol: PROTOCOL,
            }),
            shutdown,
            pendingUpdate: yield* Ref.make<string | null>(null),
        });

        const config = yield* Effect.promise(() => loadConfig(paths));
        yield* Effect.promise(() => ensureMemory(paths.memory));
        // Runs that don't come from a terminal work here; tools refuse a directory that's missing.
        yield* Effect.promise(() =>
            mkdir(config.workspace ?? paths.workspace, { recursive: true }),
        );

        // Stores and the worker wake-up first; channels, signals and the dispatcher on top of them;
        // the agent gets a host made of all of those; the runtime drives the agent.
        const base = Layer.mergeAll(
            StoresLive(paths.database),
            WorkerWake.layer,
            Settings.layer(paths, config),
        );
        const delivery = DispatcherLive.pipe(
            Layer.provideMerge(Connections.layer),
            Layer.provideMerge(base),
        );
        const workspace = config.workspace ?? paths.workspace;
        const agent = Layer.unwrap(
            makeHost.pipe(
                Effect.map((host) =>
                    Agent.layer(defaultAgentConfig(paths.home, workspace, host, options.loadPi)),
                ),
            ),
        ).pipe(Layer.provide(delivery));
        const core = Runtime.layer.pipe(Layer.provideMerge(agent), Layer.provideMerge(delivery));
        const app = Layer.mergeAll(
            ServerLive(paths),
            Layer.effectDiscard(Effect.forkScoped(autoUpdate)),
        ).pipe(
            Layer.provide(core),
            Layer.provide(Updater.layer(paths)),
            Layer.provide(Layer.succeed(DaemonControl, control)),
        );

        yield* Layer.build(app);
        yield* Effect.logInfo(
            `sedge ${VERSION}${isDevBuild ? ' (dev)' : ''} listening on ${paths.socket}`,
        );
        const request = yield* Deferred.await(shutdown);
        yield* Effect.logInfo(request.restart ? 'Restarting' : 'Stopping');
        return request.restart;
    }).pipe(Effect.scoped);

/** Starts a detached daemon whose output goes to `logs/daemon.log`, and returns immediately. */
export const spawnDetachedDaemon = (paths: SedgePaths, env: Record<string, string> = {}) =>
    Effect.promise(async () => {
        await mkdir(paths.logs, { recursive: true });
        const file = join(paths.logs, 'daemon.log');
        // Keep one previous log and start fresh past 10 MB, so the log can never fill a disk.
        const size = await stat(file).then(
            (s) => s.size,
            () => 0,
        );
        if (size > 10 * 1024 * 1024) await rename(file, `${file}.1`);
        const log = await open(file, 'a');
        const child = Bun.spawn(selfCommand('start', '--foreground'), {
            stdin: 'ignore',
            stdout: log.fd,
            stderr: log.fd,
            env: { ...process.env, SEDGE_HOME: paths.home, ...env },
            detached: true,
        });
        child.unref();
        await log.close();
        return child.pid;
    });

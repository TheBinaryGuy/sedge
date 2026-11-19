import { isProcessAlive, type SedgePaths } from '@repo/core';
import { Effect, Schema } from 'effect';
import { mkdir, open, readFile, rm } from 'node:fs/promises';

export class DaemonAlreadyRunning extends Schema.TaggedError<DaemonAlreadyRunning>()(
    'DaemonAlreadyRunning',
    { pid: Schema.Number },
) {}

const readPid = (path: string) =>
    Effect.promise(() =>
        readFile(path, 'utf8').then(
            (text) => Number.parseInt(text, 10) || undefined,
            () => undefined,
        ),
    );

/**
 * Holds `daemon.lock` for the life of the scope. Two daemons draining one inbox is exactly the
 * "competing runs" failure an always-on agent has to rule out, so a second daemon refuses to
 * start rather than racing. A lock left by a dead process is taken over.
 */
export const acquireDaemonLock = (paths: SedgePaths) =>
    Effect.acquireRelease(
        Effect.gen(function* () {
            yield* Effect.promise(() => mkdir(paths.home, { recursive: true }));
            for (let attempt = 0; attempt < 3; attempt++) {
                const created = yield* Effect.promise(() =>
                    open(paths.lock, 'wx').then(
                        async (handle) => {
                            await handle.writeFile(String(process.pid));
                            await handle.close();
                            return true;
                        },
                        (error: NodeJS.ErrnoException) => {
                            if (error.code === 'EEXIST') return false;
                            throw error;
                        },
                    ),
                );
                if (created) {
                    // Only the lock holder may clear a socket file a crashed daemon left behind.
                    if (process.platform !== 'win32') {
                        yield* Effect.promise(() => rm(paths.socket, { force: true }));
                    }
                    return;
                }
                const holder = yield* readPid(paths.lock);
                if (holder !== undefined && holder !== process.pid && isProcessAlive(holder)) {
                    return yield* new DaemonAlreadyRunning({ pid: holder });
                }
                yield* Effect.promise(() => rm(paths.lock, { force: true }));
            }
            return yield* Effect.die(new Error(`Could not take ${paths.lock}`));
        }),
        () =>
            Effect.gen(function* () {
                if ((yield* readPid(paths.lock)) === process.pid) {
                    yield* Effect.promise(() => rm(paths.lock, { force: true }));
                }
            }),
    );

/** A restarted daemon waits for the one it replaces to let go of the lock. */
export const waitForExit = (pid: number) =>
    Effect.gen(function* () {
        for (let i = 0; i < 100 && isProcessAlive(pid); i++) yield* Effect.sleep('100 millis');
    });

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Everything Sedge keeps on disk lives under one directory: `~/.sedge` by default, or
 * `SEDGE_HOME` when set (the repo's `bun run sedge` points it at `.sedge-dev` so development
 * never touches a real install).
 */
export const sedgeHome = (): string => process.env.SEDGE_HOME ?? join(homedir(), '.sedge');

export interface SedgePaths {
    readonly home: string;
    /** Unix domain socket (named pipe on Windows) the daemon listens on. */
    readonly socket: string;
    /** Holds the daemon's pid while it runs; only one daemon may hold it. */
    readonly lock: string;
    readonly database: string;
    readonly logs: string;
    /** pi's agent directory: credentials, models, settings, sessions. */
    readonly agent: string;
    /** Where the standalone installer puts the binary. */
    readonly bin: string;
}

export const sedgePaths = (home: string = sedgeHome()): SedgePaths => ({
    home,
    socket:
        process.platform === 'win32'
            ? `\\\\.\\pipe\\sedge-${createHash('sha256').update(home).digest('hex').slice(0, 12)}`
            : join(home, 'sedge.sock'),
    lock: join(home, 'daemon.lock'),
    database: join(home, 'sedge.db'),
    logs: join(home, 'logs'),
    agent: join(home, 'agent'),
    bin: join(home, 'bin'),
});

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
    /** Settings and secrets (the Telegram token); owner-only, never readable by the agent. */
    readonly config: string;
    /** The agent's memory: instructions, notes and task progress, as files. */
    readonly memory: string;
    /** Default working directory for runs that don't come from a terminal (Telegram, timers). */
    readonly workspace: string;
    /** Secrets for sources (`NAME=value` lines), referenced from the config as `${NAME}`. */
    readonly env: string;
    /** Installed source packages (`sedge install …`), a small npm project of its own. */
    readonly packages: string;
    /** Source type modules you registered; copied here so nothing can change them afterwards. */
    readonly sourceTypes: string;
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
    config: join(home, 'config.json'),
    memory: join(home, 'memory'),
    workspace: join(home, 'workspace'),
    env: join(home, '.env'),
    packages: join(home, 'packages'),
    sourceTypes: join(home, 'source-types'),
});

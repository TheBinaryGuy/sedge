import { mcpNamespace } from '@earendil-works/pi-mcp';
import {
    createMcpAuthProvider,
    McpRefreshLockBusyError,
    type McpOAuthServerStore,
    type McpOAuthSettings,
} from '@earendil-works/pi-mcp/oauth';
import lockfile from 'proper-lockfile';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * MCP sign-ins, shared with the TUI. When you sign in to a server with `/mcp` in sedge, pi keeps
 * its tokens in `<agent dir>/mcp-auth.json`; the daemon reads the same file, refreshes the same
 * tokens, and takes the same locks pi takes, so the two never refresh at once (a refresh token
 * used twice is often a refresh token revoked).
 *
 * This follows pi's own store (its file, its keys, its lock files), which pi doesn't export.
 */

const REFRESH_LOCK_STALE_MS = 20_000;
const REFRESH_LOCK_WAIT_MS = 25_000;
const REFRESH_LOCK_RETRY_MS = 100;

type States = Record<string, unknown>;

/** Reads and maybe rewrites the file under pi's lock on it. */
const withFileLock = <A>(
    file: string,
    use: (states: States) => { result: A; next?: States },
): A => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (!existsSync(file)) writeFileSync(file, '{}', { mode: 0o600 });
    let release: (() => void) | undefined;
    for (let attempt = 1; ; attempt++) {
        try {
            release = lockfile.lockSync(file);
            break;
        } catch (error) {
            if (attempt === 10) throw error;
            const until = Date.now() + 20;
            while (Date.now() < until) {
                // pi waits like this too: the store's callers are synchronous.
            }
        }
    }
    try {
        const text = readFileSync(file, 'utf8');
        const parsed: unknown = text.trim() ? JSON.parse(text) : {};
        const states =
            typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
                ? (parsed as States)
                : {};
        const { result, next } = use(states);
        if (next) writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        return result;
    } finally {
        release?.();
    }
};

export const mcpAuthStore = (agentDir: string) => {
    const file = join(agentDir, 'mcp-auth.json');
    return (name: string, serverUrl: string): McpOAuthServerStore => {
        const legacy = String(new URL(serverUrl));
        const key = `${mcpNamespace(name)}|${legacy}`;
        return {
            load: () =>
                withFileLock(file, (states) => ({
                    result: (states[key] ?? states[legacy]) as never,
                })),
            save: (state) =>
                withFileLock(file, (states) => ({
                    result: undefined,
                    next: { ...states, [key]: state },
                })),
            withRefreshLock: async (fn) => {
                mkdirSync(agentDir, { recursive: true, mode: 0o700 });
                const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
                const release = await lockfile
                    .lock(join(agentDir, `mcp-auth-refresh-${hash}`), {
                        realpath: false,
                        stale: REFRESH_LOCK_STALE_MS,
                        retries: {
                            retries: REFRESH_LOCK_WAIT_MS / REFRESH_LOCK_RETRY_MS,
                            factor: 1,
                            minTimeout: REFRESH_LOCK_RETRY_MS,
                            maxTimeout: REFRESH_LOCK_RETRY_MS,
                        },
                        onCompromised: () => {},
                    })
                    .catch((error: unknown) => {
                        if (error instanceof Error && 'code' in error && error.code === 'ELOCKED') {
                            throw new McpRefreshLockBusyError();
                        }
                        throw error;
                    });
                try {
                    return await fn();
                } finally {
                    await release().catch(() => undefined);
                }
            },
        };
    };
};

/** Whether the TUI has signed in to this server. */
export const hasSignedIn = (agentDir: string, name: string, serverUrl: string) => {
    const state = mcpAuthStore(agentDir)(name, serverUrl).load() as
        | { tokens?: unknown }
        | undefined;
    return Boolean(state?.tokens);
};

/**
 * An auth provider for an HTTP MCP server, from the TUI's sign-in. The daemon can't open a browser,
 * so a server that needs a new sign-in fails with a message saying where to do it.
 */
export const daemonAuthProvider = (options: {
    readonly agentDir: string;
    readonly name: string;
    readonly serverUrl: string;
    readonly settings: McpOAuthSettings;
    readonly onSignInNeeded: () => void;
}) =>
    createMcpAuthProvider({
        serverUrl: options.serverUrl,
        store: mcpAuthStore(options.agentDir)(options.name, options.serverUrl),
        // The TUI signs in as `sedge` with dynamic registration; refreshes reuse what it registered.
        clientName: 'sedge',
        settings: () => ({ ...options.settings, clientRegistration: 'dcr' }),
        onChallenge: options.onSignInNeeded,
    });

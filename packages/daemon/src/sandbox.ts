import { type Sandbox, sandboxPolicy } from '@sedge-hq/agent';
import type { SedgeConfig, SedgePaths } from '@sedge-hq/core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * sedge's own files that no run may touch: everything in its home but the memory and the
 * workspace. Its config and secrets, the socket the TUI talks to the daemon over (through which
 * anything could ask the daemon to act), the database (inbox, approvals), the conversations, logs,
 * packages and binary. pi's logins and MCP sign-ins too, when SEDGE_AGENT_DIR moves them.
 */
export const sedgePrivatePaths = (paths: SedgePaths, workspace: string): ReadonlyArray<string> => {
    const keep = new Set([join(paths.home, 'memory'), join(paths.home, 'workspace'), workspace]);
    const present = (() => {
        try {
            return readdirSync(paths.home).map((name) => join(paths.home, name));
        } catch {
            return [];
        }
    })();
    const known = [
        paths.config,
        paths.secrets,
        paths.lock,
        paths.database,
        `${paths.database}-wal`,
        `${paths.database}-shm`,
        paths.agent,
        paths.logs,
        paths.packages,
        paths.kinds,
        paths.bin,
        ...(process.platform === 'win32' ? [] : [paths.socket]),
        ...(process.env.SEDGE_AGENT_DIR
            ? [
                  join(process.env.SEDGE_AGENT_DIR, 'auth.json'),
                  join(process.env.SEDGE_AGENT_DIR, 'mcp-auth.json'),
              ]
            : []),
    ];
    return [...new Set([...known, ...present])].filter((path) => !keep.has(path));
};

/**
 * The sandbox from config.json, or `undefined` when it's off. Besides what the user lists, runs may
 * write to the workspace and memory, and nothing in it may touch the rest of sedge's home.
 */
export const sedgeSandbox = (
    paths: SedgePaths,
    config: SedgeConfig,
    workspace: string,
): Sandbox | undefined =>
    config.sandbox?.enabled
        ? sandboxPolicy(config.sandbox, {
              writable: [workspace, paths.memory],
              hidden: sedgePrivatePaths(paths, workspace),
          })
        : undefined;

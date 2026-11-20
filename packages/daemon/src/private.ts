import { canonical, resolveFrom } from '@sedge-hq/agent';
import type { SedgePaths } from '@sedge-hq/core';
import { sep } from 'node:path';
import { sedgePrivatePaths } from './sandbox';

/** Tool arguments that name a file or folder. */
const PATH_LIKE = /path|file|dir|cwd|target|source|dest/i;

/**
 * What keeps runs away from sedge's own files (config, secrets, socket, database, conversations):
 * `isPrivate` for a path, and `touchesPrivate` for a tool call's path arguments, resolved from the
 * run's folder with links followed. A shell command isn't judged here: its text can't be resolved
 * reliably, so the OS sandbox is what keeps commands away from these files.
 */
export const privateGuard = (paths: SedgePaths, workspace: string) => {
    const privatePaths = sedgePrivatePaths(paths, workspace).map(canonical);
    const isPrivate = (path: string) => {
        const target = canonical(path);
        return privatePaths.some((p) => target === p || target.startsWith(`${p}${sep}`));
    };
    const touchesPrivate = (cwd: string, input: Record<string, unknown>) =>
        Object.entries(input).some(
            ([key, value]) =>
                PATH_LIKE.test(key) &&
                typeof value === 'string' &&
                value !== '' &&
                value.length < 1024 &&
                isPrivate(resolveFrom(cwd, value)),
        );
    return { isPrivate, touchesPrivate };
};

import { sedgePaths } from '@sedge-hq/core';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { privateGuard } from './private';

/** A guard for a sedge home at `~/.sedge`, so `~` paths reach it. */
const guardWithHome = (paths: ReturnType<typeof sedgePaths>) =>
    privateGuard(sedgePaths(join(homedir(), '.sedge')), paths.workspace);

const home = async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'sedge-private-')));
    const paths = sedgePaths(dir);
    await mkdir(paths.workspace, { recursive: true });
    await mkdir(paths.memory, { recursive: true });
    await mkdir(paths.logs, { recursive: true });
    await writeFile(paths.config, '{}');
    await writeFile(paths.secrets, '{}');
    return { paths, guard: privateGuard(paths, paths.workspace) };
};

describe('sedge’s own files', () => {
    it('are off limits by any path a tool names, from the workspace inside sedge’s home', async () => {
        const { paths, guard } = await home();
        const ws = paths.workspace;
        // The escalation the adversarial test found: editing ../config.json from the workspace.
        expect(guard.touchesPrivate(ws, { path: '../config.json' })).toBe(true);
        expect(guard.touchesPrivate(ws, { path: paths.secrets })).toBe(true);
        // Windows has a named pipe instead of a socket file.
        if (process.platform !== 'win32') {
            expect(guard.touchesPrivate(ws, { path: '../sedge.sock' })).toBe(true);
        }
        expect(guard.touchesPrivate(ws, { path: '../logs/sedge.jsonl' })).toBe(true);
        // A link in the workspace that leads to them (making one on Windows needs rights a test
        // runner may not have).
        if (process.platform !== 'win32') {
            await symlink(paths.config, join(ws, 'innocent.json'));
            expect(guard.touchesPrivate(ws, { path: 'innocent.json' })).toBe(true);
        }
        // A `~` path, as the tools read it: the home folder, not a folder named "~".
        const tilde = guardWithHome(paths);
        expect(tilde.touchesPrivate(ws, { path: '~/.sedge/config.json' })).toBe(true);
        // What runs may touch.
        expect(guard.touchesPrivate(ws, { path: 'notes.md' })).toBe(false);
        expect(guard.touchesPrivate(ws, { path: join(paths.memory, 'MEMORY.md') })).toBe(false);
        // A file's content isn't a path.
        expect(guard.touchesPrivate(ws, { path: 'a.txt', content: '../config.json' })).toBe(false);
    });

    it('leaves shell commands to the sandbox, rather than guessing from their text', async () => {
        const { paths, guard } = await home();
        expect(guard.touchesPrivate(paths.workspace, { command: 'cat ../config.json' })).toBe(
            false,
        );
    });

    it('can’t be attached to a message', async () => {
        const { paths, guard } = await home();
        expect(guard.isPrivate(paths.secrets)).toBe(true);
        expect(guard.isPrivate(join(paths.workspace, 'report.pdf'))).toBe(false);
    });
});

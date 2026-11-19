import type { SedgePaths } from '@sedge-hq/core';
import { isPlugin, type Plugin } from '@sedge-hq/kit';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** A kind of channel or signal sedge can connect, and where it came from. */
export interface Kind {
    readonly plugin: Plugin;
    /** The npm package it came from, or `yours` for a module the user registered. */
    readonly origin: string;
    readonly path: string;
}

/**
 * A compiled sedge binary cannot resolve npm packages for a module it loads from disk, so every
 * plugin is bundled with its dependencies into one file first, by the binary itself running as
 * Bun. Bundles are cached by the module's path and modification time.
 */
export const bundle = async (path: string, cacheDir: string): Promise<string> => {
    const { mtimeMs } = await stat(path);
    const key = createHash('sha256').update(`${path}\n${mtimeMs}`).digest('hex').slice(0, 16);
    const out = join(cacheDir, `${key}.js`);
    if (
        await stat(out).then(
            () => true,
            () => false,
        )
    )
        return out;
    await mkdir(cacheDir, { recursive: true });
    const proc = Bun.spawn(
        [process.execPath, 'build', path, '--target=bun', '--format=esm', `--outfile=${out}`],
        { env: { ...process.env, BUN_BE_BUN: '1' }, stdout: 'ignore', stderr: 'pipe' },
    );
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`could not bundle ${path}: ${stderr.trim()}`);
    return out;
};

export const loadPlugin = async (path: string, cacheDir: string): Promise<Plugin> => {
    const module = (await import(await bundle(path, cacheDir))) as { default?: unknown };
    if (!isPlugin(module.default)) {
        throw new Error(`${path} does not export a defineChannel or defineSignal as default`);
    }
    return module.default;
};

/**
 * Every kind on this machine: those in installed packages (`sedge install telegram`), which list
 * their modules under "sedge": { "plugins": [...] } in package.json, and those the user
 * registered (copies in ~/.sedge/kinds). A kind that fails to load is reported, not fatal.
 */
export const discoverKinds = async (paths: SedgePaths, onError: (message: string) => void) => {
    const cache = join(paths.packages, '.bundles');
    const kinds = new Map<string, Kind>();
    const add = async (path: string, origin: string) => {
        try {
            const plugin = await loadPlugin(path, cache);
            kinds.set(plugin.name, { plugin, origin, path });
        } catch (error) {
            onError(`${origin}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const manifest = await readFile(join(paths.packages, 'package.json'), 'utf8')
        .then((text) => JSON.parse(text) as { dependencies?: Record<string, string> })
        .catch(() => ({ dependencies: {} }));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        const dir = join(paths.packages, 'node_modules', dependency);
        const pkg = await readFile(join(dir, 'package.json'), 'utf8')
            .then((text) => JSON.parse(text) as { sedge?: { plugins?: Array<string> } })
            .catch(() => undefined);
        for (const file of pkg?.sedge?.plugins ?? []) await add(join(dir, file), dependency);
    }

    const yours = await readdir(paths.kinds).catch(() => [] as Array<string>);
    for (const file of yours.filter((f) => f.endsWith('.js')))
        await add(join(paths.kinds, file), 'yours');
    return kinds;
};

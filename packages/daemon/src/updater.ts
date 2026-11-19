import { compareVersions, isDevBuild, type SedgePaths, VERSION } from '@repo/core';
import { Context, Effect, Layer, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

const REGISTRY = process.env.SEDGE_REGISTRY ?? 'https://registry.npmjs.org';

export type InstallMethod = 'npm' | 'bun' | 'pnpm' | 'standalone' | 'source';

/** Where the running binary came from decides how it gets replaced. */
export const detectInstallMethod = (paths: SedgePaths): InstallMethod => {
    const exe = process.execPath;
    if (!Bun.main.startsWith('/$bunfs/') && !/^[A-Z]:\\~BUN\\/i.test(Bun.main)) return 'source';
    if (exe.includes(`${sep}node_modules${sep}`)) {
        if (exe.includes(`${sep}.bun${sep}`)) return 'bun';
        if (exe.includes(`${sep}pnpm${sep}`)) return 'pnpm';
        return 'npm';
    }
    return exe.startsWith(paths.bin) ? 'standalone' : 'source';
};

/** The npm package holding this platform's compiled binary, as `scripts/build.ts` names them. */
export const platformPackage = () =>
    `sedge-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;

export class UpdateError extends Schema.TaggedError<UpdateError>()('UpdateError', {
    message: Schema.String,
}) {}

const fetchJson = (url: string) =>
    Effect.tryPromise({
        try: async (signal) => {
            const response = await fetch(url, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
                headers: { accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`${url} answered ${response.status}`);
            return (await response.json()) as unknown;
        },
        catch: (cause) => new UpdateError({ message: String(cause) }),
    });

const LatestManifest = Schema.Struct({ version: Schema.String });
const PlatformManifest = Schema.Struct({
    dist: Schema.Struct({ tarball: Schema.String, integrity: Schema.String }),
});

const run = (cmd: Array<string>) =>
    Effect.tryPromise({
        try: async () => {
            const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'pipe' });
            const [code, stderr] = await Promise.all([
                proc.exited,
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}: ${stderr.trim()}`);
        },
        catch: (cause) => new UpdateError({ message: String(cause) }),
    });

/**
 * Replaces the standalone binary in place: download this platform's package from the registry,
 * check it against the registry's sha512, refresh pi's assets beside the binary (themes, docs,
 * templates change between versions), then rename the new binary over the running one. Unix keeps
 * the old inode alive for the running process; Windows needs the old file moved aside first.
 */
const replaceStandalone = (version: string) =>
    Effect.gen(function* () {
        const manifest = yield* fetchJson(`${REGISTRY}/${platformPackage()}/${version}`).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(PlatformManifest)),
            Effect.mapError((e) => new UpdateError({ message: String(e) })),
        );
        const tarball = yield* Effect.tryPromise({
            try: async (signal) =>
                new Uint8Array(
                    await (await fetch(manifest.dist.tarball, { signal })).arrayBuffer(),
                ),
            catch: (cause) => new UpdateError({ message: String(cause) }),
        });
        const [algorithm, expected] = manifest.dist.integrity.split('-', 2);
        const actual = createHash(algorithm ?? 'sha512')
            .update(tarball)
            .digest('base64');
        if (algorithm !== 'sha512' || actual !== expected) {
            return yield* new UpdateError({
                message: 'Downloaded package failed its integrity check',
            });
        }

        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'sedge-update-')));
        yield* Effect.gen(function* () {
            yield* Effect.promise(() => Bun.write(join(dir, 'package.tgz'), tarball));
            yield* run(['tar', '-xzf', join(dir, 'package.tgz'), '-C', dir]);
            const extracted = join(dir, 'package', 'bin');
            const binary = join(extracted, basename(process.execPath));
            yield* Effect.tryPromise({
                try: async () => {
                    const target = dirname(process.execPath);
                    for (const entry of await readdir(extracted)) {
                        if (entry === basename(process.execPath)) continue;
                        await rm(join(target, entry), { recursive: true, force: true });
                        await cp(join(extracted, entry), join(target, entry), { recursive: true });
                    }
                    await chmod(binary, 0o755);
                    if (process.platform === 'win32') {
                        await rm(`${process.execPath}.old`, { force: true });
                        await rename(process.execPath, `${process.execPath}.old`);
                    }
                    await rename(binary, process.execPath);
                },
                catch: (cause) =>
                    new UpdateError({ message: `Could not replace binary: ${String(cause)}` }),
            });
        }).pipe(Effect.ensuring(Effect.promise(() => rm(dir, { recursive: true, force: true }))));
    });

export class Updater extends Context.Service<
    Updater,
    {
        readonly installMethod: InstallMethod;
        /** The newest published version, or null when this build is current or can't update. */
        readonly check: Effect.Effect<string | null, UpdateError>;
        readonly apply: (version: string) => Effect.Effect<void, UpdateError>;
    }
>()('sedge/daemon/Updater') {
    static readonly layer = (paths: SedgePaths) =>
        Layer.sync(Updater, () => {
            const installMethod = detectInstallMethod(paths);
            const canUpdate = !isDevBuild && installMethod !== 'source';

            const check = canUpdate
                ? fetchJson(`${REGISTRY}/sedge/latest`).pipe(
                      Effect.flatMap(Schema.decodeUnknownEffect(LatestManifest)),
                      Effect.mapError((e) => new UpdateError({ message: String(e) })),
                      Effect.map(({ version }) =>
                          compareVersions(version, VERSION) > 0 ? version : null,
                      ),
                  )
                : Effect.succeed(null);

            const apply = Effect.fn('Updater.apply')(function* (version: string) {
                switch (installMethod) {
                    case 'npm':
                        return yield* run(['npm', 'install', '-g', `sedge@${version}`]);
                    case 'bun':
                        return yield* run(['bun', 'add', '-g', `sedge@${version}`]);
                    case 'pnpm':
                        return yield* run(['pnpm', 'add', '-g', `sedge@${version}`]);
                    case 'standalone':
                        return yield* replaceStandalone(version);
                    case 'source':
                        return yield* new UpdateError({
                            message: 'Running from source; pull and rebuild instead.',
                        });
                }
            });

            return Updater.of({ installMethod, check, apply });
        });
}

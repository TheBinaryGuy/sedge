import {
    CLI_PACKAGE,
    compareVersions,
    isCompiled,
    isDevBuild,
    registryPath,
    REPOSITORY,
    type SedgePaths,
    VERSION,
} from '@sedge-hq/core';
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
    if (!isCompiled()) return 'source';
    if (exe.includes(`${sep}node_modules${sep}`)) {
        if (exe.includes(`${sep}.bun${sep}`)) return 'bun';
        if (exe.includes(`${sep}pnpm${sep}`)) return 'pnpm';
        return 'npm';
    }
    return exe.startsWith(paths.bin) ? 'standalone' : 'source';
};

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

const GITHUB_API = process.env.SEDGE_GITHUB_API ?? 'https://api.github.com';

const Release = Schema.Struct({
    tag_name: Schema.String,
    assets: Schema.Array(
        Schema.Struct({
            name: Schema.String,
            browser_download_url: Schema.String,
            digest: Schema.optional(Schema.NullOr(Schema.String)),
        }),
    ),
});

const fetchRelease = (path: string) =>
    fetchJson(`${GITHUB_API}/repos/${REPOSITORY}/releases/${path}`).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Release)),
        Effect.mapError((e) => new UpdateError({ message: String(e) })),
    );

/** The release archive for this machine, as `scripts/release.ts` names them. */
const hostAsset = () =>
    `sedge-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}.tar.gz`;

/**
 * Replaces the standalone install (`curl -fsSL sedge.sh | sh`) in place: download this machine's
 * archive from the GitHub release, check it against the sha256 GitHub records for it, refresh
 * pi's assets beside the binary (themes, docs and templates change between versions), then rename
 * the new binary over the running one. Unix keeps the old inode alive for the running process;
 * Windows needs the old file moved aside first.
 */
const replaceStandalone = (version: string) =>
    Effect.gen(function* () {
        const release = yield* fetchRelease(`tags/v${version}`);
        const asset = release.assets.find((a) => a.name === hostAsset());
        if (!asset?.digest?.startsWith('sha256:')) {
            return yield* new UpdateError({
                message: `Release v${version} has no checksummed ${hostAsset()}`,
            });
        }
        const archive = yield* Effect.tryPromise({
            try: async (signal) => {
                const response = await fetch(asset.browser_download_url, { signal });
                if (!response.ok) throw new Error(`download answered ${response.status}`);
                return new Uint8Array(await response.arrayBuffer());
            },
            catch: (cause) => new UpdateError({ message: String(cause) }),
        });
        if (createHash('sha256').update(archive).digest('hex') !== asset.digest.slice(7)) {
            return yield* new UpdateError({ message: 'The download failed its checksum' });
        }

        const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'sedge-update-')));
        yield* Effect.gen(function* () {
            yield* Effect.promise(() => Bun.write(join(dir, 'sedge.tar.gz'), archive));
            yield* run(['tar', '-xzf', join(dir, 'sedge.tar.gz'), '-C', dir]);
            const extracted = join(dir, 'bin');
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

            // A standalone install follows GitHub releases; a package-manager install, npm.
            const latest =
                installMethod === 'standalone'
                    ? fetchRelease('latest').pipe(Effect.map((r) => r.tag_name.replace(/^v/, '')))
                    : fetchJson(`${REGISTRY}/${registryPath(CLI_PACKAGE)}/latest`).pipe(
                          Effect.flatMap(Schema.decodeUnknownEffect(LatestManifest)),
                          Effect.mapError((e) => new UpdateError({ message: String(e) })),
                          Effect.map(({ version }) => version),
                      );
            const check = canUpdate
                ? latest.pipe(
                      Effect.map((version) =>
                          compareVersions(version, VERSION) > 0 ? version : null,
                      ),
                  )
                : Effect.succeed(null);

            const apply = Effect.fn('Updater.apply')(function* (version: string) {
                switch (installMethod) {
                    case 'npm':
                        return yield* run(['npm', 'install', '-g', `${CLI_PACKAGE}@${version}`]);
                    case 'bun':
                        return yield* run(['bun', 'add', '-g', `${CLI_PACKAGE}@${version}`]);
                    case 'pnpm':
                        return yield* run(['pnpm', 'add', '-g', `${CLI_PACKAGE}@${version}`]);
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

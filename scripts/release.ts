import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_PACKAGE } from '../packages/core/src/packages';

/*
 * Publishes the version in apps/cli/package.json, which `changeset version` has just bumped.
 * The release workflow runs this on every push to main; when that version is already on npm it
 * does nothing, so only merging the "Version Packages" PR actually ships.
 *
 * Order matters: platform packages first, the `sedge` launcher last, so nobody can install a
 * launcher whose binaries aren't on the registry yet. Then a git tag and a GitHub release.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = (await Bun.file(join(root, 'apps/cli/package.json')).json()) as {
    version: string;
};

const run = async (cmd: Array<string>, cwd = root) => {
    console.log(`$ ${cmd.join(' ')}`);
    const proc = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
    if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} exited with an error`);
};

const out = join(root, 'dist/npm');
// Provenance needs the OIDC token GitHub Actions provides; skip it for a manual local publish.
const provenance = process.env.GITHUB_ACTIONS ? ['--provenance'] : [];
const onNpm = (name: string, version: string) =>
    Bun.spawnSync(['npm', 'view', `${name}@${version}`, 'version'], { stderr: 'ignore' })
        .stdout.toString()
        .trim() === version;

if (onNpm(CLI_PACKAGE, version)) {
    console.log(`${CLI_PACKAGE}@${version} is already on npm.`);
} else {
    await run(['bun', 'scripts/build.ts', '--all']);
    const platforms = (await readdir(out)).filter((name) => name !== 'sedge');
    for (const name of [...platforms, 'sedge']) {
        await run(['npm', 'publish', '--access', 'public', ...provenance], join(out, name));
    }

    if (process.env.GITHUB_ACTIONS) {
        const tag = `v${version}`;
        const archives: Array<string> = [];
        for (const name of platforms) {
            const archive = join(out, `${name}.tar.gz`);
            await run(['tar', '-czf', archive, '-C', join(out, name), 'bin']);
            archives.push(archive);
        }
        await run(['git', 'tag', tag]);
        await run(['git', 'push', 'origin', tag]);
        await run([
            'gh',
            'release',
            'create',
            tag,
            '--title',
            tag,
            '--notes-from-tag',
            '--verify-tag',
            ...archives,
        ]);
    }
    console.log(`Released ${CLI_PACKAGE}@${version}`);
}

/*
 * The kit and the packages built on it (`@sedge-hq/kit`, `@sedge-hq/telegram`) version on their own,
 * kit first since the others depend on it. Each is packed the way bun publishes (workspace
 * references rewritten) and published when its version is new.
 */
await mkdir(out, { recursive: true });
for (const dir of ['packages/kit', 'packages/telegram']) {
    const pkg = (await Bun.file(join(root, dir, 'package.json')).json()) as {
        name: string;
        version: string;
        private?: boolean;
    };
    if (pkg.private || onNpm(pkg.name, pkg.version)) continue;
    const pack = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', out, '--quiet'], {
        cwd: join(root, dir),
    });
    const tarball = pack.stdout.toString().trim().split('\n').pop()!;
    await run(['npm', 'publish', join(out, tarball), '--access', 'public', ...provenance]);
    console.log(`Released ${pkg.name}@${pkg.version}`);
}

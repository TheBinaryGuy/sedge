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

/** The section `changeset version` wrote for `version` in the CLI's changelog. */
const changelogFor = async (version: string) => {
    const changelog = await Bun.file(join(root, 'apps/cli/CHANGELOG.md')).text();
    const start = changelog.indexOf(`\n## ${version}\n`);
    if (start === -1) return '';
    const body = changelog.slice(start + `\n## ${version}\n`.length);
    const end = body.search(/\n## /);
    return (end === -1 ? body : body.slice(0, end)).trim();
};

const out = join(root, 'dist/npm');
const REGISTRY = 'https://registry.npmjs.org';
// Provenance needs the OIDC token GitHub Actions provides; skip it for a manual local publish.
const provenance = process.env.GITHUB_ACTIONS ? ['--provenance'] : [];
const onNpm = (name: string, version: string) =>
    Bun.spawnSync(['npm', 'view', `${name}@${version}`, 'version'], { stderr: 'ignore' })
        .stdout.toString()
        .trim() === version;

/** Waits until installs can see `name@version`, asking the registry past its caches. */
const visible = async (name: string, version: string) => {
    const url = `${REGISTRY}/${name.replace('/', '%2f')}/${version}`;
    for (let waited = 0; waited < 30 * 60; waited += 10) {
        const response = await fetch(`${url}?t=${Date.now()}`, {
            headers: { 'cache-control': 'no-cache' },
        }).catch(() => undefined);
        if (response?.ok) return;
        if (waited % 60 === 0) console.log(`Waiting for ${name}@${version} to show on npm…`);
        await Bun.sleep(10_000);
    }
    throw new Error(`${name}@${version} still isn't on npm after 30 minutes`);
};

// A tag means this version went out already, even if npm doesn't show it yet (a staged publish
// waiting for approval): publishing again would fail, and so would tagging.
const tagged = (tag: string) =>
    Bun.spawnSync(['git', 'ls-remote', '--exit-code', '--tags', 'origin', tag], { cwd: root })
        .exitCode === 0;

if (onNpm(CLI_PACKAGE, version) || (process.env.GITHUB_ACTIONS && tagged(`v${version}`))) {
    console.log(`${CLI_PACKAGE}@${version} is already released.`);
} else {
    await run(['bun', 'scripts/build.ts', '--all']);
    const platforms = (await readdir(out)).filter((name) => name !== 'sedge');
    const nameOf = async (dir: string) =>
        ((await Bun.file(join(dir, 'package.json')).json()) as { name: string }).name;
    const publish = async (dir: string) => {
        const pkg = await nameOf(dir);
        // A release that failed partway published some already; npm refuses those a second time.
        if (onNpm(pkg, version)) {
            console.log(`${pkg}@${version} is on npm already.`);
            return;
        }
        await run(['npm', 'publish', '--access', 'public', ...provenance], dir);
    };
    for (const name of platforms) await publish(join(out, name));
    // npm accepts a publish minutes before installs can see it, and an install that can't find
    // this machine's binary skips it without a word. So the launcher waits for all of them.
    for (const name of platforms) await visible(await nameOf(join(out, name)), version);
    await publish(join(out, 'sedge'));

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
        // This version's changelog (each entry links its commit or PR and its author), followed by
        // GitHub's own notes: the merged PRs and a link to the full diff since the last release.
        await run([
            'gh',
            'release',
            'create',
            tag,
            '--title',
            tag,
            '--notes',
            await changelogFor(version),
            '--generate-notes',
            '--verify-tag',
            ...archives,
        ]);
    }
    console.log(`Released ${CLI_PACKAGE}@${version}`);
}

/*
 * The kit and the packages built on it (`@sedge-hq/kit`, then telegram, slack, github, web, local and mqtt) version on their own,
 * kit first since the others depend on it. Each is packed the way bun publishes (workspace
 * references rewritten) and published when its version is new.
 */
await mkdir(out, { recursive: true });
for (const dir of [
    'packages/kit',
    'packages/telegram',
    'packages/slack',
    'packages/github',
    'packages/web',
    'packages/local',
    'packages/mqtt',
]) {
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
    // bun prints the tarball's path, absolute in newer versions; resolve takes either.
    const cmd = ['npm', 'publish', resolve(out, tarball), '--access', 'public', ...provenance];
    console.log(`$ ${cmd.join(' ')}`);
    const publish = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'pipe' });
    const stderr = publish.stderr.toString();
    process.stderr.write(stderr);
    // A version npm still holds for approval (staged publishing) doesn't show in `npm view`,
    // but it is published: npm refuses it again, and that is not a failure.
    if (
        publish.exitCode !== 0 &&
        !stderr.includes('cannot publish over the previously published')
    ) {
        throw new Error(`Publishing ${pkg.name}@${pkg.version} failed`);
    }
    console.log(`Released ${pkg.name}@${pkg.version}`);
}

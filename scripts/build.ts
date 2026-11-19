import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Compiles `sedge` into one self-contained binary per platform and lays each out as an npm
 * package under dist/npm, next to the `sedge` launcher package that depends on all of them.
 *
 *   bun scripts/build.ts          this machine's platform only
 *   bun scripts/build.ts --all    every release platform
 *
 * pi's Bun binary reads its themes, assets, docs and HTML export templates from the directory the
 * executable is in, and a package.json there names the app; ours says `sedge`, so pi's TUI, title
 * and update notice carry Sedge's name and version.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'apps/cli');
// The real path: pi's own dependencies resolve from its store directory, not the workspace link.
const pi = await realpath(resolve(cli, 'node_modules/@earendil-works/pi-coding-agent'));
const out = join(root, 'dist/npm');
const manifest = (await Bun.file(join(cli, 'package.json')).json()) as {
    version: string;
    description: string;
    license: string;
    repository: unknown;
};
const version = manifest.version;

export const TARGETS = [
    { os: 'darwin', cpu: 'arm64' },
    { os: 'darwin', cpu: 'x64' },
    { os: 'linux', cpu: 'x64' },
    { os: 'linux', cpu: 'arm64' },
    { os: 'windows', cpu: 'x64' },
] as const;

const host = { os: process.platform === 'win32' ? 'windows' : process.platform, cpu: process.arch };
const targets = process.argv.includes('--all')
    ? TARGETS
    : TARGETS.filter((t) => t.os === host.os && t.cpu === host.cpu);
if (targets.length === 0) throw new Error(`No release target for ${host.os}-${host.cpu}`);

const sh = async (cmd: Array<string>, cwd = root) => {
    const proc = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
    if ((await proc.exited) !== 0) throw new Error(`${cmd.join(' ')} failed`);
};

const resolvePackageFile = (spec: string) => Bun.resolveSync(spec, join(pi, 'package.json'));

await rm(out, { recursive: true, force: true });

for (const { os, cpu } of targets) {
    const name = `sedge-${os}-${cpu}`;
    const dir = join(out, name);
    const bin = join(dir, 'bin');
    await mkdir(bin, { recursive: true });
    console.log(`\n→ ${name}@${version}`);

    await sh(
        [
            'bun',
            'build',
            '--compile',
            '--minify',
            `--target=bun-${os}-${cpu}`,
            '--no-compile-autoload-bunfig',
            '--no-compile-autoload-dotenv',
            `--define=SEDGE_VERSION=${JSON.stringify(version)}`,
            '--root=.',
            'src/main.ts',
            'src/utils/image-resize-worker.ts',
            'src/extensions/codemode/worker.ts',
            `--outfile=${join(bin, os === 'windows' ? 'sedge.exe' : 'sedge')}`,
        ],
        cli,
    );

    // The files pi's own binary ships beside the executable.
    const dist = join(pi, 'dist');
    await cp(join(dist, 'modes/interactive/theme'), join(bin, 'theme'), {
        recursive: true,
        filter: (src) => !/\.(js|ts|map)$/.test(src),
    });
    await cp(join(dist, 'modes/interactive/assets'), join(bin, 'assets'), { recursive: true });
    await mkdir(join(bin, 'export-html'), { recursive: true });
    for (const file of ['template.html', 'template.css', 'template.js']) {
        await cp(join(dist, 'core/export-html', file), join(bin, 'export-html', file));
    }
    await cp(join(dist, 'core/export-html/vendor'), join(bin, 'export-html/vendor'), {
        recursive: true,
    });
    await cp(join(pi, 'docs'), join(bin, 'docs'), { recursive: true });
    await cp(join(pi, 'README.md'), join(bin, 'README.md'));
    await cp(join(pi, 'CHANGELOG.md'), join(bin, 'CHANGELOG.md'));
    await cp(
        resolvePackageFile('@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
        join(bin, 'photon_rs_bg.wasm'),
    );
    await writeFile(
        join(bin, 'package.json'),
        `${JSON.stringify({ name: 'sedge', version, piConfig: { name: 'sedge', configDir: '.pi' } }, null, 4)}\n`,
    );

    await writeFile(
        join(dir, 'package.json'),
        `${JSON.stringify(
            {
                name,
                version,
                description: `The sedge binary for ${os}-${cpu}. Install \`sedge\` instead.`,
                license: manifest.license,
                repository: manifest.repository,
                os: [os === 'windows' ? 'win32' : os],
                cpu: [cpu],
                files: ['bin'],
            },
            null,
            4,
        )}\n`,
    );
}

// The package people install: the launcher, depending on every platform build.
const launcher = join(out, 'sedge');
await mkdir(join(launcher, 'bin'), { recursive: true });
await cp(join(cli, 'bin/sedge.js'), join(launcher, 'bin/sedge.js'));
await cp(join(root, 'README.md'), join(launcher, 'README.md'));
await cp(join(root, 'LICENSE'), join(launcher, 'LICENSE'));
await cp(join(root, 'docs'), join(launcher, 'docs'), { recursive: true });
await writeFile(
    join(launcher, 'package.json'),
    `${JSON.stringify(
        {
            name: 'sedge',
            version,
            description: manifest.description,
            license: manifest.license,
            repository: manifest.repository,
            bin: { sedge: 'bin/sedge.js' },
            files: ['bin', 'docs'],
            engines: { node: '>=18' },
            optionalDependencies: Object.fromEntries(
                TARGETS.map(({ os, cpu }) => [`sedge-${os}-${cpu}`, version]),
            ),
        },
        null,
        4,
    )}\n`,
);

console.log(`\nBuilt ${targets.length} platform package(s) and the launcher in ${out}`);

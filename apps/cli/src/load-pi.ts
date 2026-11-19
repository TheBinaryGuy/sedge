import { sedgeHome, VERSION } from '@sedge-hq/core';
import { mkdir, readlink, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const compiled = () => Bun.main.startsWith('/$bunfs/') || /^[A-Z]:\\~BUN\\/i.test(Bun.main);

/**
 * pi names the app after the package.json it finds beside its own code: "pi" when run from
 * source. The release binary ships a package.json that says `sedge`; from source, this builds the
 * same thing: a folder with that package.json and links to pi's real files, which pi is pointed at
 * through PI_PACKAGE_DIR. Must run before any pi module is evaluated.
 */
const brandSourceRun = async () => {
    if (compiled() || process.env.PI_PACKAGE_DIR) return;
    const pi = dirname(
        createRequire(import.meta.url).resolve('@earendil-works/pi-coding-agent/package.json'),
    );
    const dir = join(sedgeHome(), 'pi-package');
    await mkdir(dir, { recursive: true });
    await writeFile(
        join(dir, 'package.json'),
        `${JSON.stringify({ name: 'sedge', version: VERSION, piConfig: { name: 'sedge', configDir: '.pi' } })}\n`,
    );
    for (const entry of ['dist', 'docs', 'examples', 'README.md', 'CHANGELOG.md']) {
        const link = join(dir, entry);
        const current = await readlink(link).catch(() => undefined);
        if (current === join(pi, entry)) continue;
        if (current !== undefined) await Bun.$`rm -f ${link}`.quiet();
        await symlink(join(pi, entry), link);
    }
    process.env.PI_PACKAGE_DIR = dir;
};

/**
 * pi, loaded only by the commands that run it. Its Bun setup (sandbox env, the embedded QuickJS
 * wasm, Bun's OAuth flows) has to run before any pi module is evaluated, so every path to pi goes
 * through here: the TUI, `sedge pi …`, and the daemon's first background run.
 */
export const loadPi = async () => {
    await brandSourceRun();
    await import('./pi-setup');
    return import('@earendil-works/pi-coding-agent');
};

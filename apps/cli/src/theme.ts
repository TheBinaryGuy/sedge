import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SedgePaths } from '@sedge-hq/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sedgeDark from '../themes/sedge-dark.json';
import sedgeLight from '../themes/sedge-light.json';

/**
 * sedge's look in the TUI: pi's themes with the logo's green (#3fb950 on dark, #1a7f37 on light)
 * and sedge.sh's neutrals. Both are offered in /settings as `sedge-dark` and `sedge-light`. Unless
 * you picked a theme of your own (anything but pi's built-in dark, light and system), the one
 * matching your terminal is used, without saving anything to the settings you share with pi.
 */
export const registerTheme = (pi: ExtensionAPI, paths: SedgePaths) => {
    const dir = join(paths.home, 'themes');

    pi.on('resources_discover', async (_event, ctx) => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'sedge-dark.json'), `${JSON.stringify(sedgeDark, null, 4)}\n`);
        await writeFile(join(dir, 'sedge-light.json'), `${JSON.stringify(sedgeLight, null, 4)}\n`);
        if (ctx.mode === 'tui' && !(await hasOwnTheme())) {
            // The paths returned here are loaded once this handler returns.
            setTimeout(() => {
                const name = ctx.ui.theme.appearance === 'light' ? 'sedge-light' : 'sedge-dark';
                const theme = ctx.ui.getTheme(name);
                // An instance, not a name: a name would be saved to the settings pi reads too.
                if (theme) ctx.ui.setTheme(theme);
            }, 0);
        }
        return { themePaths: [dir] };
    });
};

const BUILT_IN = new Set(['dark', 'light', 'system']);

/** Whether your pi settings name a theme other than pi's own (`dark`, `light/dark`, `system`, …). */
const hasOwnTheme = async () => {
    const dir =
        process.env.SEDGE_CODING_AGENT_DIR ??
        process.env.PI_CODING_AGENT_DIR ??
        join(homedir(), '.pi', 'agent');
    const settings = await readFile(join(dir, 'settings.json'), 'utf8')
        .then((text) => JSON.parse(text) as { theme?: unknown })
        .catch(() => ({ theme: undefined }));
    if (typeof settings.theme !== 'string') return false;
    return settings.theme.split('/').some((name) => !BUILT_IN.has(name));
};

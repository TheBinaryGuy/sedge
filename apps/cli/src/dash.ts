import { ProcessTerminal, TuiAltScreen } from '@earendil-works/pi-tui';
import type { SedgePaths } from '@sedge-hq/core';
import { Effect, ManagedRuntime } from 'effect';
import { Daemon, DaemonLive } from './client';
import { DashboardView, type Paint, type Tab, TABS } from './dashboard';

const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
};
const fg = (hex: string) => (text: string) => `\u001b[38;2;${rgb(hex)}m${text}\u001b[39m`;

/** sedge's colours (the logo's green, sedge.sh's greys), readable on dark and light terminals. */
const PAINT: Paint = {
    accent: fg('#3fb950'),
    muted: fg('#8b949e'),
    dim: fg('#6e7681'),
    bold: (text) => `\u001b[1m${text}\u001b[22m`,
    error: fg('#f85149'),
    warning: fg('#d29922'),
    success: fg('#3fb950'),
    selected: (text) =>
        `\u001b[48;2;${rgb('#3fb950')}m\u001b[38;2;${rgb('#0d1117')}m${text}\u001b[39m\u001b[49m`,
};

/**
 * `sedge dash [tab] [agent]`: the dashboard on its own, full screen. It starts the daemon if it
 * isn't running, and refreshes every two seconds.
 */
export const runDash = (paths: SedgePaths, args: ReadonlyArray<string>) => {
    const [first, second] = args;
    const tab = (TABS as ReadonlyArray<string>).includes(first ?? '') ? (first as Tab) : undefined;
    const agent = tab ? second : first;

    const runtime = ManagedRuntime.make(DaemonLive(paths, { autostart: true }));
    const withDaemon = <A, E>(use: (daemon: Daemon['Service']) => Effect.Effect<A, E>) =>
        runtime.runPromise(
            Effect.gen(function* () {
                return yield* use(yield* Daemon);
            }),
        );

    const terminal = new ProcessTerminal();
    const tui = new TuiAltScreen(terminal);
    const view: DashboardView = new DashboardView({
        withDaemon,
        paint: PAINT,
        header: true,
        ...(tab ? { tab } : {}),
        ...(agent ? { agent } : {}),
        rows: () => terminal.rows,
        requestRender: () => tui.requestRender(),
        close: () => {
            view.stop();
            tui.stop();
            void runtime.dispose().finally(() => process.exit(0));
        },
    });
    tui.addChild(view);
    tui.setFocus(view);
    tui.start();
};

/**
 * pi, loaded only by the commands that run it. Its Bun setup (sandbox env, the embedded QuickJS
 * wasm, Bun's OAuth flows) has to run before any pi module is evaluated, so every path to pi goes
 * through here: the TUI, `sedge pi …`, and the daemon's first background run.
 */
export const loadPi = async () => {
    await import('./pi-setup');
    return import('@earendil-works/pi-coding-agent');
};

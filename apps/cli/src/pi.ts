import type { SedgePaths } from '@sedge-hq/core';
import { spawnDetachedDaemon } from '@sedge-hq/daemon';
import { Effect } from 'effect';
import { isListening } from './client';
import { sedgeExtension, sedgeHeader } from './extension';
import { loadPi } from './load-pi';

/**
 * `sedge` and `sedge -p`: pi's interactive and print modes with the Sedge extension. The daemon
 * is never waited for: if it isn't running it is started in the background, and the extension
 * connects once its socket is up, so the TUI appears as fast as pi's own.
 */
export const runSedgeTui = async (paths: SedgePaths, args: Array<string>) => {
    skipPiVersionCheck();
    const piReady = loadPi();
    if (!(await Effect.runPromise(isListening(paths)))) {
        void Effect.runPromise(spawnDetachedDaemon(paths));
    }
    const { main, SettingsManager, InteractiveMode } = await piReady;
    // pi draws its own header at first paint, but extensions (and so `setHeader`) only load after
    // it has found fd/rg and loaded your extensions, skills and MCP setup: a blank or pi-branded
    // header for a second or more. quietStartup makes pi's header blank (`--verbose` still shows
    // the startup details), and the hook below puts Sedge's in place at the same moment pi's would
    // have appeared. Only this process sees either change; pi's settings file is untouched.
    SettingsManager.prototype.getQuietStartup = () => true;
    installEarlyHeader(InteractiveMode.prototype);
    await main(args, { extensionFactories: [sedgeExtension(paths)] });
    // pi returns once its session ends, but MCP connections, HTTP agents and the daemon client
    // can keep the event loop alive; the process is done either way.
    process.exit(process.exitCode ?? 0);
};

/** `sedge pi …`: pi's own CLI (packages, MCP servers, config, its help), unchanged. */
export const runPiCli = async (args: Array<string>) => {
    skipPiVersionCheck();
    const { main } = await loadPi();
    await main(args.length > 0 ? args : ['--help']);
};

/** pi would offer its own updates; Sedge ships pi inside its binary and updates itself. */
const skipPiVersionCheck = () => {
    process.env.PI_SKIP_VERSION_CHECK = '1';
};

/**
 * Sets Sedge's header from inside pi's startup, right after pi's own header would have been built.
 * Both methods are pi internals, so this checks they exist; if a pi release renames them, the
 * extension still sets the header at session_start, just later.
 */
const installEarlyHeader = (proto: object) => {
    const target = proto as {
        setupKeyHandlers?: (...args: Array<unknown>) => unknown;
        setExtensionHeader?: (factory: typeof sedgeHeader) => void;
    };
    const original = target.setupKeyHandlers;
    if (typeof original !== 'function' || typeof target.setExtensionHeader !== 'function') return;
    target.setupKeyHandlers = function (this: typeof target, ...args: Array<unknown>) {
        this.setExtensionHeader?.(sedgeHeader);
        return original.apply(this, args);
    };
};

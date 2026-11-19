#!/usr/bin/env bun
import { sedgePaths, VERSION } from '@sedge-hq/core';

/*
 * The entry point stays tiny and imports only what the command needs: pi alone takes about a
 * second to load, so `sedge stop` shouldn't pay for it, and `sedge` shouldn't load the daemon.
 *
 *   sedge [pi flags] [message]   the TUI (pi's interactive mode, Sedge's extension)
 *   sedge -p "…"                 print mode
 *   sedge start|stop|update      the daemon
 *   sedge install|uninstall      packages of channels and signals
 *   sedge pi …                   pi's own commands
 */
const HELP = `sedge ${VERSION}: an always-on agent that lives on your machine

Usage
  sedge [options] [message]     open the TUI (starts the daemon if it isn't running)
  sedge -p "<prompt>"           print one reply and exit
  sedge dash [tab] [agent]      the dashboard: agents, inbox, outbox, timers, memory
  sedge start [--service]       run the daemon; --service also starts it at login
  sedge stop                    stop the daemon and remove the login service
  sedge update [--check]        update sedge
  sedge install <package>       add channels and signals, e.g. sedge install telegram
  sedge uninstall <package>     remove a package you installed
  sedge uninstall               remove sedge from this machine (--keep-data keeps ~/.sedge)
  sedge pi <command>            pi's commands: install, remove, list, config, mcp, update --extensions

In the TUI, ask for what you want ("set up telegram", "tell me when my CI fails"): sedge
sets it up, and asks you for secrets in a hidden field.

The TUI and -p also take --model, --continue, --resume, --thinking and the rest of the agent's
options; see them with: sedge pi --help`;

/** pi subcommands that only exist under `sedge pi`. */
const PI_COMMANDS = new Set(['remove', 'list', 'config', 'mcp', 'auth']);

const args = process.argv.slice(2);
const [first = ''] = args;
const paths = sedgePaths();

if (first === '--version' || first === '-v') {
    console.log(`sedge ${VERSION}`);
} else if (first === '--help' || first === '-h' || first === 'help') {
    console.log(HELP);
} else if (first === 'dash') {
    const { runDash } = await import('./dash');
    runDash(paths, args.slice(1));
} else if (['start', 'stop', 'update', 'install', 'uninstall'].includes(first)) {
    const { runSedgeCommand } = await import('./commands');
    runSedgeCommand();
} else if (first === 'pi') {
    const { runPiCli } = await import('./pi');
    await runPiCli(args.slice(1));
} else if (PI_COMMANDS.has(first)) {
    console.error(`sedge: '${first}' is a pi command; run it as: sedge pi ${args.join(' ')}`);
    process.exitCode = 1;
} else {
    const { runSedgeTui } = await import('./pi');
    await runSedgeTui(paths, args);
}

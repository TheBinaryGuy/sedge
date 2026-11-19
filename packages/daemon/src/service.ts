import { selfCommand, type SedgePaths } from '@repo/core';
import { Effect } from 'effect';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LABEL = 'dev.sedge.daemon';

const escapeXml = (value: string) =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const launchdPlist = (paths: SedgePaths) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${selfCommand('start', '--foreground')
    .map((arg) => `        <string>${escapeXml(arg)}</string>`)
    .join('\n')}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SEDGE_HOME</key><string>${escapeXml(paths.home)}</string>
        <key>SEDGE_SUPERVISED</key><string>1</string>
        <key>PATH</key><string>${escapeXml(process.env.PATH ?? '/usr/bin:/bin')}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${escapeXml(join(paths.logs, 'daemon.log'))}</string>
    <key>StandardErrorPath</key><string>${escapeXml(join(paths.logs, 'daemon.log'))}</string>
</dict>
</plist>
`;

const systemdUnit = (paths: SedgePaths) => `[Unit]
Description=Sedge always-on agent

[Service]
ExecStart=${selfCommand('start', '--foreground')
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .join(' ')}
Environment=SEDGE_HOME=${paths.home}
Environment=SEDGE_SUPERVISED=1
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;

const sh = (cmd: Array<string>) =>
    Effect.promise(async () => {
        const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
        return (await proc.exited) === 0;
    });

/**
 * Registers the daemon with the OS so it starts at login and comes back after a crash. A
 * supervised daemon still restarts itself after an update; launchd/systemd simply bring it back
 * if that ever fails.
 */
export const installService = (paths: SedgePaths) =>
    Effect.gen(function* () {
        yield* Effect.promise(() => mkdir(paths.logs, { recursive: true }));
        if (process.platform === 'darwin') {
            const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
            yield* Effect.promise(() =>
                mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true }),
            );
            yield* sh(['launchctl', 'unload', file]);
            yield* Effect.promise(() => writeFile(file, launchdPlist(paths)));
            yield* sh(['launchctl', 'load', '-w', file]);
            return file;
        }
        if (process.platform === 'linux') {
            const dir = join(
                process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
                'systemd',
                'user',
            );
            const file = join(dir, 'sedge.service');
            yield* Effect.promise(() => mkdir(dir, { recursive: true }));
            yield* Effect.promise(() => writeFile(file, systemdUnit(paths)));
            yield* sh(['systemctl', '--user', 'daemon-reload']);
            yield* sh(['systemctl', '--user', 'enable', '--now', 'sedge.service']);
            return file;
        }
        return yield* Effect.fail(
            new Error(`No service manager support for ${process.platform} yet`),
        );
    });

export const uninstallService = Effect.gen(function* () {
    if (process.platform === 'darwin') {
        const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
        yield* sh(['launchctl', 'unload', '-w', file]);
        yield* Effect.promise(() => rm(file, { force: true }));
    } else if (process.platform === 'linux') {
        yield* sh(['systemctl', '--user', 'disable', '--now', 'sedge.service']);
        const dir = join(
            process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
            'systemd',
            'user',
        );
        yield* Effect.promise(() => rm(join(dir, 'sedge.service'), { force: true }));
        yield* sh(['systemctl', '--user', 'daemon-reload']);
    }
});

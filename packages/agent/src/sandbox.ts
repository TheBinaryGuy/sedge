import type { Context } from '@earendil-works/chord/context';
import { err, ExecutionError, type ExecutionEnv, FileError } from '@earendil-works/pi-durable/env';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** The sandbox as set in config.json. */
export interface SandboxSettings {
    readonly enabled?: boolean | undefined;
    /** Whether commands may reach the network. Default: yes. */
    readonly network?: boolean | undefined;
    /** Folders commands and tools may write to, besides the run's folder, the workspace and temp. */
    readonly writable?: ReadonlyArray<string> | undefined;
    /** Files and folders nothing in the sandbox may read, besides the defaults. */
    readonly hidden?: ReadonlyArray<string> | undefined;
}

/** What a run in `cwd` may touch: canonical absolute paths. */
export interface SandboxPolicy {
    readonly writable: ReadonlyArray<string>;
    readonly hidden: ReadonlyArray<string>;
    readonly network: boolean;
}

/** Credentials and keys: never readable in the sandbox. */
const HIDDEN = [
    '~/.ssh',
    '~/.aws',
    '~/.azure',
    '~/.gnupg',
    '~/.kube',
    '~/.docker',
    '~/.netrc',
    '~/.npmrc',
    '~/.git-credentials',
    '~/.config/git/credentials',
    '~/.config/gh',
    '~/.config/gcloud',
    '~/.pi/agent/auth.json',
    '~/.pi/agent/mcp-auth.json',
    '~/Library/Keychains',
];

/** Caches package managers write to, so installs and builds work. */
const CACHES = ['~/.cache', '~/.npm', '~/.bun/install/cache', '~/Library/Caches'];

const expand = (path: string) =>
    path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;

/** An absolute path with symbolic links resolved, as far as the path exists. */
export const canonical = (path: string): string => {
    const absolute = resolve(expand(path));
    let existing = absolute;
    const rest: Array<string> = [];
    while (!existsSync(existing)) {
        const parent = dirname(existing);
        if (parent === existing) return absolute;
        rest.unshift(existing.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
        existing = parent;
    }
    try {
        return join(realpathSync(existing), ...rest);
    } catch {
        return absolute;
    }
};

const inside = (path: string, roots: ReadonlyArray<string>) =>
    roots.some((root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep));

/**
 * The policy for runs: `always` are writable folders sedge needs (its workspace, memory), and
 * `secret` its own files nothing may read; the run's folder is added per run with `forRun`.
 */
export const sandboxPolicy = (
    settings: SandboxSettings,
    sedge: { readonly writable: ReadonlyArray<string>; readonly hidden: ReadonlyArray<string> },
) => {
    const unique = (paths: ReadonlyArray<string>) => [...new Set(paths.map(canonical))];
    const hidden = unique([...HIDDEN, ...sedge.hidden, ...(settings.hidden ?? [])]);
    const writable = unique([
        tmpdir(),
        '/tmp',
        ...CACHES,
        ...sedge.writable,
        ...(settings.writable ?? []),
    ]);
    return {
        /** What a run working in `cwd` may touch. */
        forRun: (cwd: string): SandboxPolicy => ({
            writable: unique([...writable, cwd]),
            hidden,
            network: settings.network ?? true,
        }),
        /** Whether nothing in the sandbox may read `path`. */
        isHidden: (path: string) => inside(canonical(path), hidden),
    };
};

export type Sandbox = ReturnType<typeof sandboxPolicy>;

const quote = (path: string) => `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** macOS: a Seatbelt profile that allows everything but what the policy keeps out. */
export const seatbeltProfile = (policy: SandboxPolicy) =>
    [
        '(version 1)',
        '(allow default)',
        '(deny file-write*)',
        `(allow file-write* ${policy.writable.map((p) => `(subpath ${quote(p)})`).join(' ')} (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`,
        ...(policy.hidden.length > 0
            ? [
                  `(deny file-read* ${policy.hidden.map((p) => `(subpath ${quote(p)})`).join(' ')})`,
                  `(deny file-write* ${policy.hidden.map((p) => `(subpath ${quote(p)})`).join(' ')})`,
              ]
            : []),
        ...(policy.network
            ? []
            : ['(deny network-outbound (remote ip))', '(deny network-inbound (local ip))']),
    ].join('\n');

/** Linux: bubblewrap arguments that mount everything read-only but what the policy lets be written. */
export const bubblewrapArgs = (policy: SandboxPolicy, cwd: string) => [
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    ...policy.writable.filter((path) => existsSync(path)).flatMap((path) => ['--bind', path, path]),
    ...policy.hidden
        .filter((path) => existsSync(path))
        // A hidden folder is replaced by an empty one, a hidden file by an empty file.
        .flatMap((path) =>
            statSync(path).isDirectory() ? ['--tmpfs', path] : ['--ro-bind', '/dev/null', path],
        ),
    ...(policy.network ? [] : ['--unshare-net']),
    '--die-with-parent',
    '--chdir',
    cwd,
];

const which = (program: string) =>
    (process.env.PATH ?? '')
        .split(':')
        .map((dir) => join(dir, program))
        .find((path) => existsSync(path));

const shell = () => (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');

/** How to run a command inside the sandbox on this machine, or why it can't be. */
export const sandboxedCommand = (
    command: string | ReadonlyArray<string>,
    policy: SandboxPolicy,
    cwd: string,
): { readonly argv: ReadonlyArray<string> } | { readonly error: string } => {
    const argv = typeof command === 'string' ? [shell(), '-c', command] : [...command];
    if (process.platform === 'darwin') {
        if (!existsSync('/usr/bin/sandbox-exec')) {
            return { error: 'the sandbox is on, but this Mac has no sandbox-exec' };
        }
        return { argv: ['/usr/bin/sandbox-exec', '-p', seatbeltProfile(policy), ...argv] };
    }
    if (process.platform === 'linux') {
        const bwrap = which('bwrap');
        if (!bwrap) {
            return {
                error: 'the sandbox is on, but bubblewrap is not installed (apt install bubblewrap, dnf install bubblewrap)',
            };
        }
        return { argv: [bwrap, ...bubblewrapArgs(policy, cwd), '--', ...argv] };
    }
    return { error: `the sandbox is on, but it is not available on ${process.platform}` };
};

const READS = new Set([
    'readTextFile',
    'openTextLineReader',
    'readTextLines',
    'readBinaryFile',
    'openBinaryReader',
    'fileInfo',
    'listDir',
    'listFiles',
    'openDirReader',
    'exists',
]);
const WRITES = new Set(['writeFile', 'appendFile', 'truncateFile', 'remove', 'createDir']);

/**
 * `inner` with the sandbox around it: commands run inside the OS sandbox, file tools can't read a
 * hidden path or write outside the writable ones. Anything refused comes back as a normal error.
 */
export const sandboxedEnv = (inner: ExecutionEnv, policy: SandboxPolicy): ExecutionEnv => {
    const at = (path: string) => canonical(isAbsolute(path) ? path : resolve(inner.cwd, path));
    const denied = (path: string, write: boolean) => {
        const target = at(path);
        if (inside(target, policy.hidden)) return `${path} is hidden by the sandbox`;
        if (write && !inside(target, policy.writable)) {
            return `the sandbox doesn't let tools write to ${path}; it can write to the run's folder, the workspace and temp, and the folders in sandbox.writable`;
        }
        return undefined;
    };
    return new Proxy(inner, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver) as unknown;
            if (typeof key !== 'string' || typeof value !== 'function') return value;
            const method = value as (...args: Array<unknown>) => unknown;
            if (READS.has(key) || WRITES.has(key)) {
                return (path: string, ...rest: Array<unknown>) => {
                    const why = denied(path, WRITES.has(key));
                    if (why)
                        return Promise.resolve(err(new FileError('permission_denied', why, path)));
                    return method.call(target, path, ...rest);
                };
            }
            if (key === 'renameFile') {
                return (from: string, to: string, ...rest: Array<unknown>) => {
                    const why = denied(from, true) ?? denied(to, true);
                    if (why)
                        return Promise.resolve(err(new FileError('permission_denied', why, from)));
                    return method.call(target, from, to, ...rest);
                };
            }
            if (key === 'exec') {
                return (
                    command: string | ReadonlyArray<string>,
                    options: { cwd?: string } | undefined,
                    context: Context,
                ) => {
                    const cwd = options?.cwd ? resolve(target.cwd, options.cwd) : target.cwd;
                    const wrapped = sandboxedCommand(command, policy, cwd);
                    if ('error' in wrapped) {
                        return Promise.resolve(
                            err(new ExecutionError('spawn_error', wrapped.error)),
                        );
                    }
                    return method.call(target, wrapped.argv, options, context);
                };
            }
            return method.bind(target);
        },
    });
};

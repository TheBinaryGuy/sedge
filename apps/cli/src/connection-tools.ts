import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { selfCommand } from '@sedge-hq/core';
import type { ConnectionInfo, KindInfo } from '@sedge-hq/protocol';
import { Effect } from 'effect';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Type } from 'typebox';
import type { Daemon } from './client';
import { askSecret } from './secret-dialog';

type WithDaemon = <A, E>(use: (daemon: Daemon['Service']) => Effect.Effect<A, E>) => Promise<A>;

const text = (value: string) => ({
    content: [{ type: 'text' as const, text: value }],
    details: undefined,
});

/** `telegram` means the official `@sedge-hq/telegram`; anything with a scope, slash or dot is as given. */
export const packageSpec = (name: string) =>
    /^[a-z][a-z0-9-]*$/.test(name) ? `@sedge-hq/${name}` : name;

const describeKind = (kind: KindInfo) =>
    [
        `- ${kind.name} (${kind.origin}): ${kind.summary}`,
        ...kind.fields.map(
            (field) =>
                `    ${field.name}${field.secret ? ' (secret: leave it out, the user types it)' : ''}${field.optional ? ' (optional)' : ''}: ${field.description}`,
        ),
    ].join('\n');

const describeConnection = (connection: ConnectionInfo) =>
    [
        `- ${connection.name} (${connection.kind}): ${connection.status}`,
        ...(connection.instruction ? [`    when it fires: ${connection.instruction}`] : []),
        ...(connection.match ? [`    only events matching: ${connection.match}`] : []),
        ...(connection.ignore ? [`    ignoring events matching: ${connection.ignore}`] : []),
        ...(connection.when ? [`    only when: ${connection.when}`] : []),
        ...(connection.throttle ? [`    at most one event per: ${connection.throttle}`] : []),
        ...(connection.batch ? [`    batched: ${connection.batch}`] : []),
        ...(connection.triage ? ['    triaged by a cheap model first'] : []),
    ].join('\n');

const EVENT_OPTIONS = {
    match: Type.Optional(
        Type.String({
            description:
                'For a signal: only events whose text matches this regular expression (any case), e.g. "fail|error".',
        }),
    ),
    ignore: Type.Optional(
        Type.String({
            description:
                'For a signal: drop events whose text matches this regular expression (any case).',
        }),
    ),
    when: Type.Optional(
        Type.String({
            description:
                'For a signal: only events that meet this condition on their details, like "temperature > 30 and room = kitchen" or "payload.moisture < 30". Fields are paths into the event\'s details (see what it reports); operators =, !=, >, >=, <, <=, contains; and/or. `text` is the event\'s text.',
        }),
    ),
    throttle: Type.Optional(
        Type.String({
            description:
                'For a signal that repeats (an alarm, a sensor over a limit): after an event gets through, drop the next ones for this long (10m, 1h).',
        }),
    ),
    batch: Type.Optional(
        Type.String({
            description:
                'For a signal that fires often: hold events this long after the first (30s, 5m, 1h) and hand them to the agent together, in one run.',
        }),
    ),
    triage: Type.Optional(
        Type.Boolean({
            description:
                'For a signal whose events mostly need nothing: a cheap model reads each event (or batch) with the instruction first, and the agent wakes only when it should. Costs a little per event, far less than a run.',
        }),
    ),
};

const describeOptions = (options: {
    match?: string;
    ignore?: string;
    when?: string;
    throttle?: string;
    batch?: string;
    triage?: boolean;
}) => [
    ...(options.match ? [`· only events matching: ${options.match}`] : []),
    ...(options.ignore ? [`· ignoring events matching: ${options.ignore}`] : []),
    ...(options.when ? [`· only when: ${options.when}`] : []),
    ...(options.throttle ? [`· at most one event per: ${options.throttle}`] : []),
    ...(options.batch ? [`· batched: ${options.batch}`] : []),
    ...(options.triage ? ['· triaged by a cheap model first'] : []),
];

/** The nearest package.json above `dir` that declares sedge channels or signals, if any. */
export const kitPackage = async (
    dir: string,
): Promise<{ name: string; dir: string } | undefined> => {
    for (let current = dir; ; current = dirname(current)) {
        const pkg = await readFile(join(current, 'package.json'), 'utf8')
            .then((t) => JSON.parse(t) as { name?: string; sedge?: { plugins?: unknown } })
            .catch(() => undefined);
        if (pkg)
            return pkg.sedge?.plugins ? { name: pkg.name ?? current, dir: current } : undefined;
        if (dirname(current) === current) return undefined;
    }
};

/** Bundles a module with everything it imports, using this binary as Bun. */
export const bundleModule = async (file: string): Promise<{ code: string } | { error: string }> => {
    const out = join(await mkdtemp(join(tmpdir(), 'sedge-kind-')), 'module.js');
    const proc = Bun.spawn(
        [process.execPath, 'build', file, '--target=bun', '--format=esm', `--outfile=${out}`],
        { env: { ...process.env, BUN_BE_BUN: '1' }, stdout: 'ignore', stderr: 'pipe' },
    );
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) return { error: stderr.trim() };
    return { code: await readFile(out, 'utf8') };
};

/** The npm keyword that marks a package of channels and signals. */
const KEYWORD = 'sedge-kit';

interface NpmSearch {
    readonly objects: ReadonlyArray<{
        readonly package: {
            readonly name: string;
            readonly version: string;
            readonly description?: string;
            readonly publisher?: { readonly username?: string };
            readonly links?: { readonly npm?: string };
        };
    }>;
}

const message = (error: unknown) =>
    error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);

/**
 * Channels and signals in the TUI. The agent connects them when you ask ("set up telegram", "tell
 * me when my CI fails") and you confirm each step. Secrets are typed into a hidden field that goes
 * straight to the daemon and on to the keychain; they never pass through the conversation.
 */
export const registerConnectionTools = (pi: ExtensionAPI, withDaemon: WithDaemon) => {
    const overview = async (type: 'channel' | 'signal') => {
        const [connections, kinds] = await Promise.all([
            withDaemon(({ client }) => client.Connections()),
            withDaemon(({ client }) => client.Kinds()),
        ]);
        const mine = connections.filter((c) => c.type === type || c.type === 'unknown');
        const available = kinds.filter((k) => k.type === type);
        return { mine, available };
    };

    pi.registerTool({
        name: 'channels',
        label: 'Channels',
        description:
            'List the channels sedge talks to the user on (Telegram, for example), how each is doing, and the channel kinds that are installed, with their settings.',
        promptSnippet: 'See how sedge reaches the user, and what can be connected',
        parameters: Type.Object({}),
        execute: async () => {
            const { mine, available } = await overview('channel');
            return text(
                `Connected:\n${mine.map(describeConnection).join('\n') || '(none)'}\n\nKinds that can be connected:\n${available.map(describeKind).join('\n') || '(none installed; `install` adds them, e.g. "telegram")'}`,
            );
        },
    });

    pi.registerTool({
        name: 'signals',
        label: 'Signals',
        description:
            'List the signals that wake sedge when something happens elsewhere, what it does for each, and the signal kinds that are installed, with their settings.',
        promptSnippet: 'See what wakes sedge up, and what can be connected',
        parameters: Type.Object({}),
        execute: async () => {
            const { mine, available } = await overview('signal');
            return text(
                `Connected:\n${mine.map(describeConnection).join('\n') || '(none)'}\n\nKinds that can be connected:\n${available.map(describeKind).join('\n') || '(none installed)'}\n\nNothing fits? Write one and register it with create_signal.`,
            );
        },
    });

    pi.registerTool({
        name: 'connect',
        label: 'Connect',
        description:
            "Connect a channel or signal of an installed kind. Pass its settings except secrets: the user is asked for each secret in a hidden field. For a signal, `instruction` says what to do when it fires, in the user's words; `match`, `ignore` and `when` filter its events before they wake the agent, `throttle` quiets a repeating one, `batch` gathers a noisy one's events into one run, and `triage` has a cheap model decide which events need the agent. The user confirms first. A channel returns an invite link that pairs the user's account.",
        promptSnippet: 'Connect a channel (Telegram …) or a signal (CI, a feed …)',
        promptGuidelines: [
            'Never ask the user to paste a token or password into the chat: connect asks for secrets in a hidden field.',
        ],
        parameters: Type.Object({
            name: Type.String({ description: 'Lowercase name, e.g. "telegram" or "ci".' }),
            kind: Type.String({ description: 'An installed kind (see channels / signals).' }),
            settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
            instruction: Type.Optional(
                Type.String({ description: 'For a signal: what to do when it fires.' }),
            ),
            ...EVENT_OPTIONS,
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const kinds = await withDaemon(({ client }) => client.Kinds());
            const kind = kinds.find((k) => k.name === params.kind);
            if (!kind) {
                return text(
                    `No kind "${params.kind}" is installed (installed: ${kinds.map((k) => k.name).join(', ') || 'none'}). Install it with the install tool.`,
                );
            }
            const settings = params.settings ?? {};
            const problem = await withDaemon(({ client }) =>
                client.CheckSettings({ kind: params.kind, settings }).pipe(Effect.result),
            );
            if (problem._tag === 'Failure')
                return text(`Not connected: ${message(problem.failure)}`);
            if (problem.success) return text(`Not connected: ${problem.success}`);

            const shown = Object.entries(settings).map(([k, v]) => `· ${k}: ${JSON.stringify(v)}`);
            const ok = await ctx.ui.confirm(
                `Connect the ${kind.type} "${params.name}" (${kind.name})?`,
                [
                    kind.summary,
                    ...shown,
                    ...(params.instruction ? [`· when it fires: ${params.instruction}`] : []),
                    ...describeOptions(params),
                    ...(kind.fields.some((f) => f.secret)
                        ? ['Secrets are asked for next and kept in your keychain.']
                        : []),
                ].join('\n'),
            );
            if (!ok) return text('The user declined; nothing was connected.');

            const secrets: Record<string, string> = {};
            for (const field of kind.fields.filter((f) => f.secret)) {
                const value = await askSecret(
                    ctx,
                    `${params.name}: ${field.name}`,
                    field.description,
                );
                if (value === undefined) {
                    if (!field.optional) {
                        return text(
                            `The user cancelled; ${field.name} is needed, so nothing was connected.`,
                        );
                    }
                    continue;
                }
                secrets[field.name] = value;
            }

            const connected = await withDaemon(({ client }) =>
                client
                    .Connect({
                        name: params.name,
                        kind: params.kind,
                        settings,
                        secrets,
                        instruction: params.instruction ?? null,
                        ...(params.match ? { match: params.match } : {}),
                        ...(params.ignore ? { ignore: params.ignore } : {}),
                        ...(params.batch ? { batch: params.batch } : {}),
                        ...(params.when ? { when: params.when } : {}),
                        ...(params.throttle ? { throttle: params.throttle } : {}),
                        ...(params.triage ? { triage: true } : {}),
                    })
                    .pipe(Effect.result),
            );
            if (connected._tag === 'Failure')
                return text(`Not connected: ${message(connected.failure)}`);
            return text(
                connected.success.invite
                    ? `Connected. To pair their account, give the user this, exactly: ${connected.success.invite}\nIt pairs whoever uses it, works once and expires in 30 minutes; until then the channel answers no one.`
                    : `Connected; ${params.name} is running.`,
            );
        },
    });

    pi.registerTool({
        name: 'invite',
        label: 'Invite',
        description:
            'A new one-time invite link for a connected channel: to pair another account, or when the last link expired.',
        parameters: Type.Object({ name: Type.String() }),
        execute: async (_id, params) => {
            const link = await withDaemon(({ client }) =>
                client.Invite({ name: params.name }).pipe(Effect.result),
            );
            return text(
                link._tag === 'Failure'
                    ? `No invite: ${message(link.failure)}`
                    : `Invite link (one use, 30 minutes): ${link.success}`,
            );
        },
    });

    pi.registerTool({
        name: 'update_signal',
        label: 'Update signal',
        description:
            'Change what a connected signal does when it fires: its `instruction`, the `match`, `ignore` and `when` filters, the `throttle` and `batch` windows, or `triage`. Leave out what stays; pass an empty string (or `triage: false`) to clear one. The user confirms first.',
        parameters: Type.Object({
            name: Type.String(),
            instruction: Type.Optional(Type.String()),
            ...EVENT_OPTIONS,
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const { name, ...changes } = params;
            const shown = Object.entries(changes).map(([key, value]) =>
                value ? `· ${key}: ${String(value)}` : `· ${key}: (cleared)`,
            );
            if (shown.length === 0) return text('Nothing to change.');
            const ok = await ctx.ui.confirm(`Change the signal "${name}"?`, shown.join('\n'));
            if (!ok) return text('The user declined; nothing changed.');
            const updated = await withDaemon(({ client }) =>
                client
                    .UpdateSignal({
                        name,
                        ...(Object.fromEntries(
                            Object.entries(changes).map(([key, value]) => [key, value || null]),
                        ) as Record<string, string | null>),
                        ...(changes.triage === undefined ? {} : { triage: changes.triage }),
                    })
                    .pipe(Effect.result),
            );
            return text(
                updated._tag === 'Failure'
                    ? `Not changed: ${message(updated.failure)}`
                    : `Changed ${name}; it applies to the next event.`,
            );
        },
    });

    pi.registerTool({
        name: 'disconnect',
        label: 'Disconnect',
        description:
            'Stop a channel or signal and forget it, with its secrets. The user confirms first.',
        parameters: Type.Object({ name: Type.String() }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const ok = await ctx.ui.confirm(
                `Disconnect "${params.name}"?`,
                'It stops, and its settings and secrets are deleted.',
            );
            if (!ok) return text('The user declined.');
            const removed = await withDaemon(({ client }) =>
                client.Disconnect({ name: params.name }).pipe(Effect.result),
            );
            return text(
                removed._tag === 'Failure'
                    ? `Not disconnected: ${message(removed.failure)}`
                    : `Disconnected ${params.name}.`,
            );
        },
    });

    pi.registerTool({
        name: 'install',
        label: 'Install',
        description:
            'Install a package of channels and signals: a short name like "telegram" (the official @sedge-hq/telegram), a full npm name, or the path of a package folder (one whose package.json lists "sedge": { "plugins": … }). Its code runs inside the sedge daemon with the user\'s rights, so the user confirms first.',
        parameters: Type.Object({
            name: Type.String({ description: 'e.g. "telegram", an npm name, or a folder path.' }),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const spec = packageSpec(params.name);
            const official = spec.startsWith('@sedge-hq/');
            const local = spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~');
            const ok = await ctx.ui.confirm(
                `Install ${spec}?`,
                official
                    ? 'An official package of channels and signals, from sedge.'
                    : local
                      ? 'A package folder on this machine. Its code runs inside the sedge daemon with your rights.'
                      : `A community package: sedge didn't write or review it, and its code runs inside the sedge daemon with your rights. Look at it first: https://www.npmjs.com/package/${spec.replace(/@[^@/]*$/, '')}`,
            );
            if (!ok) return text('The user declined; nothing was installed.');
            const proc = Bun.spawn(selfCommand('install', spec), {
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const [code, out, err] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) return text(`Installing ${spec} failed:\n${(err || out).trim()}`);
            return text(`${out.trim()}\nNow connect one with the connect tool.`);
        },
    });

    pi.registerTool({
        name: 'uninstall',
        label: 'Uninstall',
        description:
            'Uninstall a package of channels and signals that install added: "telegram" or its full npm name. Its kinds must not be connected: disconnect those first. The user confirms first.',
        parameters: Type.Object({
            name: Type.String({ description: 'e.g. "telegram" or an npm name.' }),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const ok = await ctx.ui.confirm(
                `Uninstall ${packageSpec(params.name)}?`,
                'Its channels and signals can no longer be connected until you install it again.',
            );
            if (!ok) return text('The user declined; nothing was uninstalled.');
            const proc = Bun.spawn(selfCommand('uninstall', params.name), {
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const [code, out, err] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) return text(`Uninstalling failed:\n${(err || out).trim()}`);
            return text(out.trim());
        },
    });

    pi.registerTool({
        name: 'find_packages',
        label: 'Find packages',
        description:
            'Search npm for packages of channels and signals (official ones and the community’s, all tagged "sedge-kit"), optionally for words like "slack" or "github". Shows each with its publisher, so the user can choose; install one with install.',
        promptSnippet: 'Find channels and signals others made, on npm',
        parameters: Type.Object({
            query: Type.Optional(Type.String({ description: 'Words to look for, e.g. "slack".' })),
        }),
        execute: async (_id, params) => {
            const url = new URL('https://registry.npmjs.org/-/v1/search');
            url.searchParams.set(
                'text',
                `keywords:${KEYWORD}${params.query ? ` ${params.query}` : ''}`,
            );
            url.searchParams.set('size', '20');
            const found = await fetch(url).then(
                async (response) =>
                    response.ok ? ((await response.json()) as NpmSearch) : undefined,
                () => undefined,
            );
            if (!found) return text('npm could not be searched just now.');
            if (found.objects.length === 0) {
                return text(
                    `No packages${params.query ? ` for "${params.query}"` : ''} yet. Nothing fits? Write a signal and register it with create_signal.`,
                );
            }
            return text(
                found.objects
                    .map(({ package: pkg }) => {
                        const official = pkg.name.startsWith('@sedge-hq/');
                        return `- ${pkg.name}@${pkg.version}${official ? ' (official)' : ` (community, by ${pkg.publisher?.username ?? 'unknown'})`}: ${pkg.description ?? ''}\n  ${pkg.links?.npm ?? ''}`;
                    })
                    .join('\n'),
            );
        },
    });

    pi.registerTool({
        name: 'create_signal',
        label: 'Create signal',
        description:
            'Register a signal (or channel) module you wrote: a .ts file whose default export is defineSignal(...) or defineChannel(...) from @sedge-hq/kit. It is bundled with what it imports, and the user reviews it before it is registered: it runs inside the sedge daemon with their rights. For a package folder, use install instead.',
        parameters: Type.Object({
            name: Type.String({ description: 'The file name it is kept under, lowercase.' }),
            path: Type.String({ description: 'Path of the module file.' }),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const file = resolve(ctx.cwd, params.path);
            const code = await readFile(file, 'utf8').catch(() => undefined);
            if (code === undefined) return text(`Cannot read ${file}.`);
            const owner = await kitPackage(dirname(file));
            if (owner) {
                return text(
                    `${file} belongs to the package ${owner.name} (${owner.dir}). Install the package instead: install with name "${owner.dir}".`,
                );
            }
            // Bundled here, where its relative files and dependencies resolve; the daemon gets one
            // self-contained file.
            const bundled = await bundleModule(file);
            if ('error' in bundled) return text(`Could not bundle ${file}:\n${bundled.error}`);
            const imports = [...code.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map(
                (m) => m[1],
            );
            const ok = await ctx.ui.confirm(
                `Register ${params.name}?`,
                `${file} (${code.length} characters; imports ${imports.join(', ') || 'nothing'}, bundled in) becomes a program that runs inside the sedge daemon with your rights, outside any sandbox. Read the file before you say yes; what you approve is copied and that copy is what runs.`,
            );
            if (!ok) return text('The user declined; nothing was registered.');
            const added = await withDaemon(({ client }) =>
                client.AddKind({ name: params.name, code: bundled.code }).pipe(Effect.result),
            );
            return text(
                added._tag === 'Failure'
                    ? `Not registered: ${message(added.failure)}`
                    : `Registered the ${added.success.type} kind ${added.success.name}: ${added.success.summary}. Connect it with the connect tool.`,
            );
        },
    });
};

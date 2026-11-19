import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { selfCommand } from '@sedge-hq/core';
import type { SourceTypeInfo } from '@sedge-hq/protocol';
import type { OptionsSchema } from '@sedge-hq/source';
import { Effect, Stream } from 'effect';
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

const describeType = (type: SourceTypeInfo) => {
    const schema = type.options as OptionsSchema;
    const options = Object.entries(schema.properties ?? {})
        .map(
            ([key, spec]) =>
                `    ${key} (${spec.type}${spec.secret ? ', secret: leave it out, the user types it' : ''}${schema.required?.includes(key) ? ', required' : ''}): ${spec.description ?? ''}`,
        )
        .join('\n');
    return `- ${type.name} (${type.origin}): ${type.summary}${type.sends ? `\n  sends: ${type.sends}` : ''}\n${options}`;
};

/** The nearest package.json above `dir` that declares sedge sources, if any. */
export const sourcePackage = async (
    dir: string,
): Promise<{ name: string; dir: string } | undefined> => {
    for (let current = dir; ; current = dirname(current)) {
        const pkg = await readFile(join(current, 'package.json'), 'utf8')
            .then((t) => JSON.parse(t) as { name?: string; sedge?: { sources?: unknown } })
            .catch(() => undefined);
        if (pkg)
            return pkg.sedge?.sources ? { name: pkg.name ?? current, dir: current } : undefined;
        if (dirname(current) === current) return undefined;
    }
};

/** Bundles a module with everything it imports, using this binary as Bun. */
export const bundleModule = async (file: string): Promise<{ code: string } | { error: string }> => {
    const out = join(await mkdtemp(join(tmpdir(), 'sedge-type-')), 'module.js');
    const proc = Bun.spawn(
        [process.execPath, 'build', file, '--target=bun', '--format=esm', `--outfile=${out}`],
        { env: { ...process.env, BUN_BE_BUN: '1' }, stdout: 'ignore', stderr: 'pipe' },
    );
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) return { error: stderr.trim() };
    return { code: await readFile(out, 'utf8') };
};

const message = (error: unknown) =>
    error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);

/**
 * Sources in the TUI: the agent sets them up when you ask ("set up telegram", "make a source
 * that tells me when my CI fails"), and you confirm each step. Secrets are typed into a hidden field that goes straight to
 * the daemon; they never pass through the conversation.
 */
export const registerSourceTools = (pi: ExtensionAPI, withDaemon: WithDaemon) => {
    const types = () => withDaemon(({ client }) => client.SourceTypes());

    pi.registerTool({
        name: 'sources',
        label: 'Sources',
        description:
            'List the event sources sedge has (what reports into your inbox: chats, folders, devices), how each is doing, and the source types that can be set up with their options.',
        promptSnippet: 'See which event sources exist and which types can be set up',
        parameters: Type.Object({}),
        execute: async () => {
            const [configured, available] = await Promise.all([
                withDaemon(({ client }) => client.Sources()),
                types(),
            ]);
            const list = configured.length
                ? configured
                      .map(
                          (s) =>
                              `- ${s.name} (${s.type}): ${s.status}${s.description ? ` · ${s.description}` : ''}`,
                      )
                      .join('\n')
                : '(none)';
            const kinds = available.length
                ? available.map(describeType).join('\n')
                : '(none installed)';
            return text(
                `Sources:\n${list}\n\nTypes that can be set up:\n${kinds}\n\nMore types come as packages: install_source_package (for example "telegram"). A type of your own: write a module and call add_source_type.`,
            );
        },
    });

    pi.registerTool({
        name: 'add_source',
        label: 'Add source',
        description:
            'Set up an event source of an installed type. Pass its options except secrets: the user is asked for each secret in a hidden field. The user confirms what the source will do before anything is saved.',
        promptSnippet: 'Set up an event source (a chat, a folder, a device …)',
        promptGuidelines: [
            'Never ask the user to paste a token or password into the chat: add_source asks for secrets in a hidden field.',
        ],
        parameters: Type.Object({
            name: Type.String({ description: 'Lowercase name, e.g. "telegram" or "ci".' }),
            type: Type.String({ description: 'A source type from the `sources` tool.' }),
            description: Type.String({ description: 'One line: what it reports.' }),
            options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const available = await types();
            const type = available.find((t) => t.name === params.type);
            if (!type) {
                return text(
                    `There is no source type "${params.type}". Installed: ${available.map((t) => t.name).join(', ') || 'none'}. Install it with install_source_package.`,
                );
            }
            const options = params.options ?? {};
            const plan = await withDaemon(({ client }) =>
                client.PlanSource({ type: params.type, options }).pipe(Effect.result),
            );
            if (plan._tag === 'Failure') return text(`Not set up: ${message(plan.failure)}`);

            const ok = await ctx.ui.confirm(
                `Set up the ${params.type} source "${params.name}"?`,
                `It will:\n${plan.success.does.map((line) => `· ${line}`).join('\n')}`,
            );
            if (!ok) return text('The user declined; nothing was set up.');

            const schema = type.options as OptionsSchema;
            const secrets: Record<string, string> = {};
            for (const [key, spec] of Object.entries(schema.properties ?? {})) {
                if (!spec.secret) continue;
                const value = await askSecret(ctx, `${params.name}: ${key}`, spec.description);
                if (value === undefined) {
                    if (schema.required?.includes(key))
                        return text(`The user cancelled; ${key} is needed, so nothing was set up.`);
                    continue;
                }
                secrets[key] = value;
            }

            const added = await withDaemon(({ client }) =>
                client
                    .AddSource({
                        name: params.name,
                        type: params.type,
                        description: params.description,
                        options,
                        secrets,
                    })
                    .pipe(Effect.result),
            );
            if (added._tag === 'Failure') return text(`Not set up: ${message(added.failure)}`);
            return text(
                `The ${params.name} source is set up and running.${added.success.tell ? ` Tell the user: ${added.success.tell}` : ''}`,
            );
        },
    });

    pi.registerTool({
        name: 'remove_source',
        label: 'Remove source',
        description: 'Stop a source and delete it, with its secrets. The user confirms first.',
        parameters: Type.Object({ name: Type.String() }),
        execute: async (_id, params, _signal, _update, ctx) => {
            if (
                !(await ctx.ui.confirm(
                    `Remove the source "${params.name}"?`,
                    'It stops, and its entry and secrets are deleted.',
                ))
            ) {
                return text('The user declined.');
            }
            const removed = await withDaemon(({ client }) =>
                client.RemoveSource({ name: params.name }).pipe(Effect.result),
            );
            return text(
                removed._tag === 'Failure'
                    ? `Not removed: ${message(removed.failure)}`
                    : `Removed ${params.name}.`,
            );
        },
    });

    pi.registerTool({
        name: 'install_source_package',
        label: 'Install source package',
        description:
            'Install a package of source types into sedge: a name like "telegram" (the official @sedge-hq/telegram), a full npm package name, or the path of a package folder (one with a package.json that lists sources under "sedge"). Use this, not add_source_type, for anything that is a package. Its code runs inside the sedge daemon with the user\'s rights, so the user confirms first.',
        parameters: Type.Object({
            name: Type.String({
                description: 'e.g. "telegram", a full npm package name, or a package folder path.',
            }),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const spec = packageSpec(params.name);
            const ok = await ctx.ui.confirm(
                `Install ${spec}?`,
                'An npm package of source types. Its code runs inside the sedge daemon with your rights.',
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
            return text(`${out.trim()}\nNow set a source up with add_source.`);
        },
    });

    pi.registerTool({
        name: 'add_source_type',
        label: 'Add source type',
        description:
            'Register a source type module you wrote yourself (a .ts file exporting `type` and a default start function, see @sedge-hq/source). For a package (a folder with a package.json), use install_source_package instead. The module is bundled with what it imports, and the user reviews it before it is registered: it runs inside the sedge daemon with their rights.',
        parameters: Type.Object({
            name: Type.String({ description: 'The type name, lowercase.' }),
            path: Type.String({ description: 'Path of the module file.' }),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const file = resolve(ctx.cwd, params.path);
            const code = await readFile(file, 'utf8').catch(() => undefined);
            if (code === undefined) return text(`Cannot read ${file}.`);

            const owner = await sourcePackage(dirname(file));
            if (owner) {
                return text(
                    `${file} belongs to the source package ${owner.name} (${owner.dir}). Install the package instead: install_source_package with name "${owner.dir}".`,
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
                `Register ${params.name} as a source type?`,
                `${file} (${code.length} characters; imports ${imports.join(', ') || 'nothing'}, bundled in) becomes a program that runs inside the sedge daemon with your rights, outside any sandbox. Read the file before you say yes; what you approve is copied and that copy is what runs.`,
            );
            if (!ok) return text('The user declined; nothing was registered.');
            const added = await withDaemon(({ client }) =>
                client.AddSourceType({ name: params.name, code: bundled.code }).pipe(Effect.result),
            );
            return text(
                added._tag === 'Failure'
                    ? `Not registered: ${message(added.failure)}`
                    : `Registered ${params.name}: ${added.success.summary}. Set one up with add_source.`,
            );
        },
    });
};

/** Questions sources ask (a pairing code) appear in the TUI as an input dialog. */
export const watchQuestions = (ctx: ExtensionContext) => (daemon: Daemon['Service']) =>
    daemon.client.Questions().pipe(
        Stream.runForEach((question) =>
            Effect.promise(async () => {
                const answer = await ctx.ui.input(
                    `${question.title}${question.detail ? `\n${question.detail}` : ''}`,
                    'type it here',
                );
                await Effect.runPromise(
                    daemon.client
                        .Answer({ id: question.id, answer: answer?.trim() || null })
                        .pipe(Effect.ignore),
                );
            }),
        ),
    );

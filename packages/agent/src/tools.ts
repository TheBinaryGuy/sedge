import {
    defineExtension,
    defineTool,
    hook,
    section,
    ToolTask,
    type ToolExecutionApi,
    type ToolExecutionResult,
} from '@earendil-works/pi-durable';
import { arr, int, obj, opt, str } from '@earendil-works/pi-schema';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AgentHost, RunContext } from './host';

const text = (value: string, isError = false): ToolExecutionResult => ({
    output: [{ type: 'text', text: value }],
    ...(isError ? { isError } : {}),
});

/** sedge's own tools never need approval: they only write to its stores. */
export const SEDGE_TOOLS = new Set([
    'send_message',
    'tell',
    'set_timer',
    'list_timers',
    'cancel_timer',
]);

/**
 * The always-on primitives as a durable extension: the outbox (`send_message`), timers, memory in
 * the system prompt, and the permission check in front of every other tool call.
 */
export const sedgeExtension = (host: AgentHost, runFor: (conversationId: number) => RunContext) =>
    defineExtension({
        name: 'sedge',
        sections: [section('sedge', (input) => host.systemPrompt(runFor(input.conversationId)))],
        hooks: [
            hook(ToolTask, {
                beforeTool: async (call, api) => {
                    if (SEDGE_TOOLS.has(call.name)) return undefined;
                    const decision = await host.checkTool(
                        runFor(api.conversationId),
                        call.name,
                        call.arguments,
                    );
                    return decision.allow ? undefined : { block: decision.reason };
                },
            }),
        ],
        tools: [
            defineTool({
                name: 'send_message',
                description:
                    'Send the user a message on their channel (Telegram, for example). Nothing else you write reaches them. `text` is Markdown. `choices` become buttons; the one they pick comes back to you as a new event. `files` are local paths to send along. Sending nothing is fine.',
                parameters: obj({
                    text: str({ description: 'The message, as you would write it in a chat.' }),
                    choices: opt(
                        arr(
                            obj({
                                label: str({ description: 'What the button says.' }),
                                value: str({ description: 'What you get back when it is picked.' }),
                            }),
                            { description: 'Buttons to pick from, a few at most.' },
                        ),
                    ),
                    files: opt(
                        arr(
                            obj({
                                path: str({ description: 'A file on this machine.' }),
                                caption: opt(str()),
                            }),
                        ),
                    ),
                }),
                execute: async (args, api) =>
                    text(await host.send(runFor(api.conversationId), args)),
            }),
            defineTool({
                name: 'tell',
                description:
                    "Message another agent (see the agents in your instructions): a task, a question, or the answer to one. It goes into that agent's inbox and wakes it; what it says back arrives as a new event. Say what you need and what to send back.",
                parameters: obj({
                    agent: str({ description: 'The agent’s name, e.g. "main" or "ci".' }),
                    message: str(),
                }),
                execute: async (args, api) =>
                    text(await host.tell(runFor(api.conversationId), args.agent, args.message)),
            }),
            defineTool({
                name: 'set_timer',
                description:
                    'Wake yourself later in this conversation. Give `in` (like 30m, 2h, 1d) or `at` (ISO date-time) for a one-off follow-up, or `cron` (five fields, local time) for a recurring schedule. `prompt` is what you will be told when it fires, so write it for your future self.',
                parameters: obj({
                    prompt: str(),
                    in: opt(str()),
                    at: opt(str()),
                    cron: opt(str()),
                    name: opt(str()),
                }),
                execute: async (args, api) =>
                    text(await host.setTimer(runFor(api.conversationId), args)),
            }),
            defineTool({
                name: 'list_timers',
                description: "List this conversation's active follow-ups and schedules.",
                parameters: obj({}),
                execute: async (_args, api) =>
                    text(await host.listTimers(runFor(api.conversationId))),
            }),
            defineTool({
                name: 'cancel_timer',
                description: 'Cancel a follow-up or schedule by its id (see list_timers).',
                parameters: obj({ id: str() }),
                execute: async (args, api) =>
                    text(
                        (await host.cancelTimer(runFor(api.conversationId), args.id))
                            ? 'Cancelled.'
                            : 'No such active timer.',
                    ),
            }),
        ],
    });

/** Your skills, listed so the agent reads one with `read` when a task calls for it. */
export const skillsExtension = (render: (conversationId: number) => string | undefined) =>
    defineExtension({
        name: 'skills',
        sections: [section('skills', (input) => render(input.conversationId), { tag: false })],
    });

// ── Read-only search, which durable's coding tools leave to bash ───────────────────────────────

const SKIP = new Set(['node_modules', '.git']);
const cwdOf = (api: ToolExecutionApi) =>
    (api.env as { cwd?: string } | undefined)?.cwd ?? process.cwd();
const under = (api: ToolExecutionApi, path?: string) =>
    path ? (isAbsolute(path) ? path : resolve(cwdOf(api), path)) : cwdOf(api);

const walk = async function* (dir: string, glob: Bun.Glob, root: string): AsyncGenerator<string> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(path, glob, root);
        else if (glob.match(relative(root, path))) yield path;
    }
};

export const searchTools = defineExtension({
    name: 'search',
    tools: [
        defineTool({
            name: 'ls',
            description: 'List a directory (the working directory by default).',
            parameters: obj({ path: opt(str()) }),
            execute: async (args, api) => {
                const dir = under(api, args.path);
                const entries = await readdir(dir, { withFileTypes: true }).catch(
                    (error: Error) => error,
                );
                if (entries instanceof Error) return text(entries.message, true);
                const lines = entries
                    .slice(0, 500)
                    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
                    .sort();
                return text(lines.join('\n') || '(empty)');
            },
        }),
        defineTool({
            name: 'find',
            description:
                'Find files by glob, like `**/*.ts` or `src/**/config.*`, skipping node_modules and .git.',
            parameters: obj({ pattern: str(), path: opt(str()) }),
            execute: async (args, api) => {
                const root = under(api, args.path);
                const found: Array<string> = [];
                for await (const path of walk(root, new Bun.Glob(args.pattern), root)) {
                    found.push(relative(root, path));
                    if (found.length >= 1000) break;
                }
                return text(found.join('\n') || 'No files match.');
            },
        }),
        defineTool({
            name: 'grep',
            description:
                'Search file contents with a regular expression. `glob` narrows the files (default all), `limit` caps the matches (default 200).',
            parameters: obj({
                pattern: str(),
                path: opt(str()),
                glob: opt(str()),
                limit: opt(int()),
            }),
            execute: async (args, api) => {
                let regex: RegExp;
                try {
                    regex = new RegExp(args.pattern);
                } catch (error) {
                    return text(`Invalid pattern: ${(error as Error).message}`, true);
                }
                const root = under(api, args.path);
                const limit = args.limit ?? 200;
                const single = await stat(root).then(
                    (s) => s.isFile(),
                    () => false,
                );
                const files = single ? [root] : walk(root, new Bun.Glob(args.glob ?? '**/*'), root);
                const matches: Array<string> = [];
                for await (const file of files) {
                    if ((await stat(file)).size > 1_000_000) continue;
                    const content = await readFile(file, 'utf8').catch(() => '');
                    if (content.includes('\u0000')) continue;
                    for (const [i, line] of content.split('\n').entries()) {
                        if (!regex.test(line)) continue;
                        matches.push(
                            `${single ? file : relative(root, file)}:${i + 1}: ${line.slice(0, 300)}`,
                        );
                        if (matches.length >= limit) break;
                    }
                    if (matches.length >= limit) break;
                }
                return text(matches.join('\n') || 'No matches.');
            },
        }),
    ],
});

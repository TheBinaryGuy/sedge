import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Effect, Stream } from 'effect';
import { Type } from 'typebox';
import type { Daemon } from './client';

type WithDaemon = <A, E>(use: (daemon: Daemon['Service']) => Effect.Effect<A, E>) => Promise<A>;

const text = (value: string) => ({
    content: [{ type: 'text' as const, text: value }],
    details: undefined,
});

const message = (error: unknown) =>
    error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);

const when = (ms: number) => new Date(ms).toLocaleString();
const owner = (thread: string) => (thread.startsWith('agent:') ? thread.slice(6) : thread);
const agentParam = Type.Optional(
    Type.String({ description: 'One agent’s name; leave it out for all.' }),
);

/**
 * Agents in the TUI: the agent here creates and changes them when you ask ("make an agent that
 * watches my CI and only tells me when main breaks"), hands them tasks, and reads their inbox,
 * outbox and timers. You confirm every change.
 */
export const registerAgentTools = (pi: ExtensionAPI, withDaemon: WithDaemon) => {
    pi.registerTool({
        name: 'agents',
        label: 'Agents',
        description:
            "List sedge's agents: main (sedge itself) and the ones the user made. For each: what it is for, which channels and signals it handles, whether it's working, what's queued, and its memory folder.",
        promptSnippet: 'See the daemon’s agents and how each is doing',
        parameters: Type.Object({}),
        execute: async () => {
            const agents = await withDaemon(({ client }) => client.Agents());
            return text(
                agents
                    .map(
                        (a) =>
                            `- ${a.name}${a.running ? ' (working)' : ''}${a.pending ? `, ${a.pending} queued` : ''}: ${a.purpose}\n  handles: ${a.connections.join(', ') || 'nothing'} · memory: ${a.memory}`,
                    )
                    .join('\n'),
            );
        },
    });

    pi.registerTool({
        name: 'create_agent',
        label: 'Create agent',
        description:
            'Create an agent, or change one: a name and its purpose in the user’s words (what it watches or does, when to bother the user, what to hand to other agents). `connections` gives it channels or signals to handle; what they bring goes to it from then on. It gets its own conversation and memory, and talks to the other agents with tell. The user confirms first.',
        promptSnippet: 'Make an agent with a purpose of its own, or change one',
        parameters: Type.Object({
            name: Type.String({ description: 'Lowercase, e.g. "ci" or "inbox".' }),
            purpose: Type.String({ description: 'What it is for, in a few sentences.' }),
            connections: Type.Optional(
                Type.Array(Type.String(), {
                    description: 'Names of connected channels or signals it should handle.',
                }),
            ),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const existing = (await withDaemon(({ client }) => client.Agents())).find(
                (a) => a.name === params.name,
            );
            const ok = await ctx.ui.confirm(
                `${existing ? 'Change' : 'Create'} the agent "${params.name}"?`,
                [
                    params.purpose,
                    ...(params.connections?.length
                        ? [`It handles: ${params.connections.join(', ')}.`]
                        : []),
                    'It runs in the background with the same permissions as sedge.',
                ].join('\n'),
            );
            if (!ok) return text('The user declined; nothing changed.');
            const saved = await withDaemon(({ client }) =>
                client
                    .SaveAgent({
                        name: params.name,
                        purpose: params.purpose,
                        connections: params.connections ?? null,
                    })
                    .pipe(Effect.result),
            );
            if (saved._tag === 'Failure') return text(`Not saved: ${message(saved.failure)}`);
            const agent = saved.success;
            return text(
                `${existing ? 'Changed' : 'Created'} ${agent.name}. It handles: ${agent.connections.join(', ') || 'nothing yet'}. Its memory: ${agent.memory}. Hand it a task with tell_agent.`,
            );
        },
    });

    pi.registerTool({
        name: 'remove_agent',
        label: 'Remove agent',
        description:
            'Remove an agent. Its channels and signals go back to main, its timers stop; its memory folder stays. The user confirms first.',
        parameters: Type.Object({ name: Type.String() }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const ok = await ctx.ui.confirm(
                `Remove the agent "${params.name}"?`,
                'Its channels and signals go back to main and its timers stop. Its memory folder is kept.',
            );
            if (!ok) return text('The user declined.');
            const removed = await withDaemon(({ client }) =>
                client.RemoveAgent({ name: params.name }).pipe(Effect.result),
            );
            return text(
                removed._tag === 'Failure'
                    ? `Not removed: ${message(removed.failure)}`
                    : `Removed ${params.name}.`,
            );
        },
    });

    pi.registerTool({
        name: 'tell_agent',
        label: 'Tell agent',
        description:
            'Hand a task to one of the daemon’s agents (main or one the user made) and wait for its answer. It works in its own conversation, with its memory.',
        promptSnippet: 'Hand a daemon agent a task and get its answer',
        parameters: Type.Object({
            agent: Type.String(),
            task: Type.String({ description: 'What it should do, and what to answer with.' }),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const answer = await withDaemon(({ client }) =>
                client.Prompt({ text: params.task, cwd: ctx.cwd, agent: params.agent }).pipe(
                    Stream.runFold(
                        () => '',
                        (last, event) => (event._tag === 'Finished' ? event.text : last),
                    ),
                    Effect.result,
                ),
            );
            return text(
                answer._tag === 'Failure'
                    ? `${params.agent} failed: ${message(answer.failure)}`
                    : `${params.agent} answered:\n\n${answer.success || '(nothing)'}`,
            );
        },
    });

    pi.registerTool({
        name: 'inbox',
        label: 'Inbox',
        description:
            'The latest events in the daemon’s inbox, newest first: what woke which agent, from where, and how it went.',
        parameters: Type.Object({ agent: agentParam, limit: Type.Optional(Type.Integer()) }),
        execute: async (_id, params) => {
            const items = await withDaemon(({ client }) =>
                client.Inbox({ agent: params.agent ?? null, limit: params.limit ?? 30 }),
            );
            return text(
                items
                    .map(
                        (item) =>
                            `- ${when(item.createdAt)} · ${owner(item.thread)} · from ${item.source} · ${item.result?.startsWith('Skipped by triage') ? `skipped (${item.result.slice(0, 200)})` : item.status}${item.error ? ` (${item.error.slice(0, 200)})` : ''}\n  ${item.prompt.replaceAll('\n', ' ').slice(0, 300)}`,
                    )
                    .join('\n') || 'No events.',
            );
        },
    });

    pi.registerTool({
        name: 'outbox',
        label: 'Outbox',
        description:
            'What the daemon’s agents sent the user (or are about to), newest first, and whether it arrived.',
        parameters: Type.Object({ agent: agentParam, limit: Type.Optional(Type.Integer()) }),
        execute: async (_id, params) => {
            const messages = await withDaemon(({ client }) =>
                client.Outbox({ agent: params.agent ?? null, limit: params.limit ?? 30 }),
            );
            return text(
                messages
                    .map(
                        (m) =>
                            `- ${when(m.createdAt)} · ${owner(m.thread)} · ${m.kind} · ${m.status}${m.error ? ` (${m.error.slice(0, 200)})` : ''}\n  ${m.text.replaceAll('\n', ' ').slice(0, 300)}`,
                    )
                    .join('\n') || 'Nothing sent.',
            );
        },
    });

    pi.registerTool({
        name: 'models',
        label: 'Models',
        description:
            "The models the daemon's runs can use (your logins), and which one the daemon, each agent and each channel or signal is set to. This TUI's own /model doesn't change any of them.",
        parameters: Type.Object({}),
        execute: async () => {
            const models = await withDaemon(({ client }) => client.Models());
            const set = (record: Readonly<Record<string, string>>) =>
                Object.entries(record).map(([name, model]) => `  ${name}: ${model}`);
            return text(
                [
                    `The daemon: ${models.daemon ?? "pi's default model"}`,
                    ...(Object.keys(models.agents).length
                        ? ['Agents:', ...set(models.agents)]
                        : []),
                    ...(Object.keys(models.connections).length
                        ? [
                              'Channels and signals (runs they wake on their own):',
                              ...set(models.connections),
                          ]
                        : []),
                    '',
                    'Available:',
                    ...models.available.map((m) => `  ${m.id} (${m.name})`),
                ].join('\n'),
            );
        },
    });

    pi.registerTool({
        name: 'set_model',
        label: 'Set model',
        description:
            "Set the model the daemon's runs use, as provider/model from `models`: for the daemon as a whole (main, and agents without their own), for one agent, or for one channel or signal (the runs it wakes on its own). Leave out model to go back to the default. Applies from the next run. The user confirms first.",
        parameters: Type.Object({
            model: Type.Optional(
                Type.String({
                    description:
                        'provider/model, as `models` lists it, with :level for how hard it thinks (off, minimal, low, medium, high, xhigh, max): anthropic/claude-opus-5-5:medium. Without one, the default thinking level.',
                }),
            ),
            agent: Type.Optional(Type.String({ description: 'One agent, instead of the daemon.' })),
            connection: Type.Optional(
                Type.String({ description: 'One channel or signal, by its name.' }),
            ),
        }),
        execute: async (_id, params, _signal, _update, ctx) => {
            const scope = params.connection
                ? `the runs ${params.connection} wakes`
                : params.agent
                  ? `the agent ${params.agent}`
                  : "the daemon's runs";
            const ok = await ctx.ui.confirm(
                'Set the model?',
                `${scope}: ${params.model ?? 'back to the default'}`,
            );
            if (!ok) return text('The user declined; nothing changed.');
            const done = await withDaemon(({ client }) =>
                client
                    .SetModel({
                        model: params.model ?? null,
                        agent: params.agent ?? null,
                        connection: params.connection ?? null,
                    })
                    .pipe(Effect.result),
            );
            return text(
                done._tag === 'Failure'
                    ? `Not set: ${message(done.failure)}`
                    : `Set: ${scope} use ${params.model ?? 'the default'} from the next run.`,
            );
        },
    });

    pi.registerTool({
        name: 'state',
        label: 'Named values',
        description:
            "Named values (mode = away): small facts the daemon's agents or remembering signals set, which signals' conditions read as state.<name>. To change one, the user asks the daemon's agent (set_state), or a signal with remember keeps it current.",
        parameters: Type.Object({}),
        execute: async () => {
            const values = await withDaemon(({ client }) => client.State());
            return text(
                values
                    .map(
                        (v) =>
                            `- ${v.name} = ${JSON.stringify(v.value)} · set by ${v.by} · ${when(v.at)}`,
                    )
                    .join('\n') || 'No named values.',
            );
        },
    });

    pi.registerTool({
        name: 'timers',
        label: 'Timers',
        description: 'The follow-ups and schedules the daemon’s agents have set.',
        parameters: Type.Object({ agent: agentParam }),
        execute: async (_id, params) => {
            const timers = await withDaemon(({ client }) =>
                client.Timers({ agent: params.agent ?? null }),
            );
            return text(
                timers
                    .map(
                        (t) =>
                            `- ${owner(t.thread)} · ${t.kind === 'schedule' ? `every ${t.cron}` : 'once'} · next ${when(t.nextRunAt)}${t.name ? ` · ${t.name}` : ''} · ${t.id}\n  ${t.prompt.replaceAll('\n', ' ').slice(0, 300)}`,
                    )
                    .join('\n') || 'No timers.',
            );
        },
    });
};

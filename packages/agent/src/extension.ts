import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { AgentHost, RunContext } from './host';

const text = (value: string) => ({
    content: [{ type: 'text' as const, text: value }],
    details: undefined,
});

const SEDGE_TOOLS = new Set(['send_message', 'set_timer', 'list_timers', 'cancel_timer']);

/**
 * The always-on primitives, as a pi extension loaded into every daemon session: the outbox
 * (`send_message`), timers, memory in the system prompt, and the permission check in front of
 * every other tool call.
 */
export const alwaysOnExtension =
    (host: AgentHost, currentRun: () => RunContext | undefined) => (pi: ExtensionAPI) => {
        const run = () => {
            const current = currentRun();
            if (!current) throw new Error('No Sedge run is active');
            return current;
        };

        pi.on('before_agent_start', async (event) => {
            const current = currentRun();
            if (!current) return undefined;
            return { systemPrompt: `${event.systemPrompt}\n\n${await host.systemPrompt(current)}` };
        });

        pi.on('tool_call', async (event) => {
            const current = currentRun();
            if (!current || SEDGE_TOOLS.has(event.toolName)) return undefined;
            const decision = await host.checkTool(current, event.toolName, event.input);
            if (decision.allow) return undefined;
            return { block: true, reason: decision.reason, terminate: decision.endRun ?? false };
        });

        pi.registerTool({
            name: 'send_message',
            label: 'Send message',
            description:
                "Send a message to the user on this conversation's channel (for example Telegram). This is the only way to reach them: your other output is not delivered. Send only what they need to know; sending nothing is fine.",
            promptSnippet: 'Reach the user (the only way your words get to them)',
            parameters: Type.Object({
                text: Type.String({
                    description: 'The message, plain text, as you would write it in a chat.',
                }),
            }),
            execute: async (_id, params) => {
                await host.send(run(), params.text);
                return text('Queued for delivery.');
            },
        });

        pi.registerTool({
            name: 'set_timer',
            label: 'Set timer',
            description:
                'Wake yourself later in this conversation. Give `in` (like 30m, 2h, 1d) or `at` (ISO date-time) for a one-off follow-up, or `cron` (five fields, local time) for a recurring schedule. `prompt` is what you will be told when it fires, so write it for your future self.',
            promptSnippet: 'Follow up later or run something on a schedule',
            parameters: Type.Object({
                prompt: Type.String(),
                in: Type.Optional(Type.String()),
                at: Type.Optional(Type.String()),
                cron: Type.Optional(Type.String()),
                name: Type.Optional(Type.String()),
            }),
            execute: async (_id, params) => text(await host.setTimer(run(), params)),
        });

        pi.registerTool({
            name: 'list_timers',
            label: 'List timers',
            description: "List this conversation's active follow-ups and schedules.",
            parameters: Type.Object({}),
            execute: async () => text(await host.listTimers(run())),
        });

        pi.registerTool({
            name: 'cancel_timer',
            label: 'Cancel timer',
            description: 'Cancel a follow-up or schedule by its id (see list_timers).',
            parameters: Type.Object({ id: Type.String() }),
            execute: async (_id, params) =>
                text(
                    (await host.cancelTimer(run(), params.id))
                        ? 'Cancelled.'
                        : 'No such active timer.',
                ),
        });
    };

import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { Message } from '@earendil-works/pi-ai';
import { type Conversation, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { int, obj, opt, str } from '@earendil-works/pi-schema';

interface Found {
    readonly thread: string;
    readonly at: number;
    readonly who: string;
    readonly text: string;
}

const textOf = (message: Message): string => {
    const { content } = message as { content: unknown };
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part: { type?: string; text?: string }) =>
            part.type === 'text' ? (part.text ?? '') : '',
        )
        .join('');
};

const whoOf = (message: Message) =>
    message.role === 'toolResult'
        ? `tool ${message.toolName}`
        : message.role === 'assistant'
          ? 'you'
          : 'user';

/** How far back one search reads in each conversation. */
const SCAN = 4000;

/**
 * Transcript search, the ground truth memory is checked against: everything said in every past
 * conversation, newest first. Dreaming uses it to correct notes; any run can use it to look back.
 */
export const recallExtension = (source: {
    readonly threads: () => ReadonlyArray<[string, number]>;
    readonly conversation: (id: number) => Promise<Conversation | undefined>;
}) =>
    defineExtension({
        name: 'recall',
        tools: [
            defineTool({
                name: 'recall',
                description:
                    'Search your past conversations, all of them, newest first: what the user said, what you answered, and what tools returned. `query` is a case-insensitive regular expression (plain words work); leave it out to read the latest. `thread` narrows it to one conversation (main, dream, cli:<dir>, …).',
                parameters: obj({
                    query: opt(str()),
                    thread: opt(str()),
                    limit: opt(int({ description: 'At most this many results (default 20).' })),
                }),
                execute: async (args) => {
                    let regex: RegExp | undefined;
                    try {
                        regex = args.query ? new RegExp(args.query, 'i') : undefined;
                    } catch {
                        regex = new RegExp(args.query!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                    }
                    const limit = Math.min(args.limit ?? 20, 100);
                    const found: Array<Found> = [];
                    for (const [thread, id] of source.threads()) {
                        if (args.thread && args.thread !== thread) continue;
                        const conversation = await source.conversation(id);
                        if (!conversation) continue;
                        let cursor: Parameters<Conversation['entries']>[2];
                        let scanned = 0;
                        let kept = 0;
                        do {
                            const page = await conversation.entries(
                                { order: 'descending' },
                                200,
                                cursor,
                                ctx,
                            );
                            for (const entry of page.items) {
                                for (const message of entry.model ?? []) {
                                    const text = textOf(message).trim();
                                    if (!text || (regex && !regex.test(text))) continue;
                                    found.push({
                                        thread,
                                        at: message.timestamp,
                                        who: whoOf(message),
                                        text: text.length > 700 ? `${text.slice(0, 700)}…` : text,
                                    });
                                    kept++;
                                }
                            }
                            scanned += page.items.length;
                            cursor = page.next;
                        } while (cursor && scanned < SCAN && kept < limit);
                    }
                    found.sort((a, b) => b.at - a.at);
                    const shown = found.slice(0, limit);
                    if (shown.length === 0)
                        return { output: [{ type: 'text', text: 'Nothing found.' }] };
                    const lines = shown.map(
                        (f) =>
                            `[${f.thread} · ${new Date(f.at).toLocaleString()} · ${f.who}] ${f.text}`,
                    );
                    return { output: [{ type: 'text', text: lines.join('\n\n') }] };
                },
            }),
        ],
    });

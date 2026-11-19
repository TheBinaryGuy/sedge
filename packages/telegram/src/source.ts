import type { SourceApi, SourceType } from '@sedge-hq/source';
import { Effect } from 'effect';
import { makeBot, splitMessage, TelegramError, type Message, type Update } from './bot';
import { toTelegramHtml } from './format';

/**
 * Telegram as a sedge source: you write to your bot from anywhere, the agent answers there, and
 * what it tells you unasked arrives in the same chat.
 *
 * It only ever talks to the account you paired. Pairing proves the person at the computer holds
 * that account: the bot sends a six-digit code to whoever writes to it, and sedge asks for that
 * code on your computer. Before pairing, an unknown account gets the code message and nothing
 * else; after pairing, unknown accounts get no answer at all.
 */
export const type: SourceType = {
    summary: 'a Telegram bot you message from anywhere; the agent answers in that chat',
    talks: true,
    toOwner: true,
    sends: 'A message to you, in your Telegram chat with the bot.',
    options: {
        type: 'object',
        properties: {
            token: {
                type: 'string',
                secret: true,
                description:
                    "The bot's token. Create a bot by writing /newbot to @BotFather in Telegram.",
            },
            apiBase: {
                type: 'string',
                description: "The address of a Bot API server of your own. Default: Telegram's.",
            },
            allow: {
                type: 'array',
                items: { type: 'number' },
                description:
                    'Telegram user ids allowed to talk to the bot, if you know yours. Without it, pair your account.',
            },
        },
        required: ['token'],
        additionalProperties: false,
    },
    plan: () => ({
        does: [
            'connect to Telegram as your bot and listen for messages to it',
            'answer only the Telegram account you pair (or list in `allow`)',
        ],
        tell: 'Open your bot in Telegram and write anything to it. It answers with a six-digit code; type that code into sedge when it asks.',
    }),
};

const PAIRED = 'paired';
const OFFSET = 'offset';

export default async function start(source: SourceApi) {
    const bot = makeBot(
        String(source.options.token),
        typeof source.options.apiBase === 'string' ? source.options.apiBase : undefined,
    );
    const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

    const me = await run(bot.getMe());
    const allowed = new Set<number>([
        ...((source.options.allow as ReadonlyArray<number> | undefined) ?? []),
        ...(JSON.parse((await source.state.get(PAIRED)) ?? '[]') as Array<number>),
    ]);
    // The private chat with an allowed account is where unasked messages go.
    let defaultChat = allowed.values().next().value as number | undefined;
    let pairing = false;
    const status = () =>
        source.status(
            allowed.size > 0
                ? `@${me.username} · paired`
                : `@${me.username} · waiting for you to write to it and pair`,
        );
    status();

    const pair = async (message: Message) => {
        const from = message.from;
        if (!from || pairing) return;
        pairing = true;
        try {
            const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
            await run(
                bot.sendMessage(
                    message.chat.id,
                    `Your sedge pairing code is ${code}. Type it into sedge on your computer when it asks.`,
                ),
            );
            const who = [from.first_name, from.username ? `@${from.username}` : undefined]
                .filter(Boolean)
                .join(' ');
            const answer = await source.ask({
                title: `Pair the Telegram account ${who} (id ${from.id}) with sedge?`,
                detail: 'Type the six-digit code the bot just sent to that account. Only pair an account that is yours.',
            });
            if (answer?.trim() === code) {
                allowed.add(from.id);
                defaultChat = message.chat.id;
                await source.state.set(PAIRED, JSON.stringify([...allowed]));
                await run(
                    bot.sendMessage(
                        message.chat.id,
                        "Paired. I'm sedge; write to me here any time.",
                    ),
                );
                status();
            } else {
                await run(
                    bot.sendMessage(
                        message.chat.id,
                        'That was not paired. Write again for a new code.',
                    ),
                );
            }
        } finally {
            pairing = false;
        }
    };

    const handle = async (update: Update) => {
        const message = update.message;
        if (message) {
            // Only the private chat with an allowed account reaches the agent; groups never do.
            if (message.chat.type !== 'private' || !message.from) return;
            if (!allowed.has(message.from.id)) {
                if (allowed.size === 0) void pair(message);
                return;
            }
            defaultChat = message.chat.id;
            const text = message.text ?? message.caption;
            if (!text) {
                await run(bot.sendMessage(message.chat.id, 'I can only read text for now.'));
                return;
            }
            await source.emit(
                'message',
                { text, name: message.from.first_name, username: message.from.username },
                { conversation: String(message.chat.id), id: String(update.update_id) },
            );
            return;
        }
        const query = update.callback_query;
        if (query) {
            if (!allowed.has(query.from.id)) return;
            await run(bot.answerCallbackQuery(query.id, 'Got it'));
            if (query.message?.text) {
                await run(
                    bot
                        .editMessageText(
                            query.message.chat.id,
                            query.message.message_id,
                            `${query.message.text}\n\n✓ Answered`,
                        )
                        .pipe(Effect.ignore),
                );
            }
            await source.emit(
                'action',
                { data: query.data ?? '' },
                {
                    conversation: String(query.message?.chat.id ?? query.from.id),
                    id: String(update.update_id),
                },
            );
        }
    };

    source.onSend(async (outgoing) => {
        const chat = outgoing.conversation ? Number(outgoing.conversation) : defaultChat;
        // Sends to anyone but the paired account are refused here, whatever the agent asked for.
        if (chat === undefined || !allowed.has(chat)) {
            throw new Error('Telegram is not paired yet; write to the bot first.');
        }
        const chunks = splitMessage(outgoing.text, 3500);
        for (const [i, chunk] of chunks.entries()) {
            const last = i === chunks.length - 1;
            const buttons =
                last && outgoing.buttons
                    ? outgoing.buttons.map((b) => ({ text: b.label, callback_data: b.data }))
                    : undefined;
            // Formatted when Telegram accepts it; plain text if it rejects the markup.
            await run(
                bot.sendMessage(chat, toTelegramHtml(chunk), buttons, 'HTML').pipe(
                    Effect.catchIf(
                        (error) => error.status === 400,
                        () => bot.sendMessage(chat, chunk, buttons),
                    ),
                ),
            );
        }
    });

    // Long polling: no public address needed. A crash between handling and saving the offset
    // redelivers the update, and the inbox drops it by its id.
    while (!source.signal.aborted) {
        try {
            const last = Number((await source.state.get(OFFSET)) ?? 0);
            const updates = await run(bot.getUpdates(last ? last + 1 : undefined, 50));
            for (const update of updates) {
                await handle(update);
                await source.state.set(OFFSET, String(update.update_id));
            }
        } catch (error) {
            if (source.signal.aborted) return;
            if (error instanceof TelegramError && error.status === 401) {
                source.status('the bot token was rejected; set the source up again');
                return;
            }
            source.status(
                `reconnecting: ${error instanceof Error ? error.message : String(error)}`,
            );
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            status();
        }
    }
}

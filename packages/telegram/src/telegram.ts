import { defineChannel, field, secret } from '@sedge-hq/kit';
import { makeBot, splitMessage, TelegramError, type Update } from './bot';
import { toTelegramHtml } from './format';

/**
 * Telegram as a sedge channel: you write to your bot from anywhere, sedge answers there, and what
 * it tells you unasked arrives in the same chat.
 *
 * It only talks to accounts paired through an invite link (`t.me/<bot>?start=<code>`): the code is
 * shown only on your screen, so opening the link proves the account is yours. Everyone else gets
 * no answer at all.
 */
export default defineChannel({
    name: 'telegram',
    summary: 'your Telegram: message sedge from anywhere, and it answers there',
    settings: {
        token: secret('The bot token. Create a bot by writing /newbot to @BotFather in Telegram.'),
        api: field.optional(
            field.text("The address of a Bot API server of your own. Default: Telegram's."),
        ),
    },
    connect: async ({ token, api }, kit) => {
        const bot = makeBot(token, api, kit.signal);
        const me = await bot.getMe();
        const paired = new Set<number>(
            JSON.parse((await kit.memo.get('paired')) ?? '[]') as Array<number>,
        );
        // In a private chat the chat id is the user's id: their usual conversation.
        let home = paired.values().next().value as number | undefined;
        const showStatus = () =>
            kit.status(
                paired.size > 0
                    ? `@${me.username} · paired`
                    : `@${me.username} · open the invite link to pair`,
            );
        showStatus();

        const handle = async (update: Update) => {
            const message = update.message;
            if (message) {
                // Only private chats; a group the bot is in never reaches sedge.
                if (message.chat.type !== 'private' || !message.from) return;
                const start = /^\/start\s+(\S+)/.exec(message.text ?? '');
                if (start && !paired.has(message.from.id)) {
                    if (await kit.claim(start[1]!, String(message.from.id))) {
                        paired.add(message.from.id);
                        home = message.chat.id;
                        await kit.memo.set('paired', JSON.stringify([...paired]));
                        await bot.sendMessage(
                            message.chat.id,
                            "Paired. I'm sedge; write to me here any time.",
                        );
                        showStatus();
                    }
                    return;
                }
                if (!paired.has(message.from.id)) return;
                home = message.chat.id;
                const text = message.text ?? message.caption;
                if (!text) return bot.sendMessage(message.chat.id, 'I can only read text for now.');
                return kit.receive({
                    type: 'message',
                    from: String(message.chat.id),
                    text,
                    key: String(update.update_id),
                });
            }
            const query = update.callback_query;
            if (query && paired.has(query.from.id)) {
                await bot.answerCallbackQuery(query.id);
                if (query.message?.text) {
                    await bot
                        .editMessageText(
                            query.message.chat.id,
                            query.message.message_id,
                            `${query.message.text}\n\n✓`,
                        )
                        .catch(() => undefined);
                }
                await kit.receive({
                    type: 'picked',
                    from: String(query.message?.chat.id ?? query.from.id),
                    value: query.data ?? '',
                    key: String(update.update_id),
                });
            }
        };

        const chatFor = (to?: string) => {
            const chat = to !== undefined ? Number(to) : home;
            if (chat === undefined || !paired.has(chat)) {
                throw new Error('Telegram is not paired yet; open the invite link first.');
            }
            return chat;
        };

        return {
            // Long polling. The offset is saved once each update went through: a crash redelivers
            // rather than drops, and sedge drops repeats.
            listen: async () => {
                while (!kit.signal.aborted) {
                    const offset = Number((await kit.memo.get('offset')) ?? '0');
                    const updates = await bot.getUpdates(offset ? offset + 1 : undefined, 50);
                    for (const update of updates) {
                        await handle(update);
                        await kit.memo.set('offset', String(update.update_id));
                    }
                }
            },
            invite: (code) => `https://t.me/${me.username}?start=${code}`,
            working: async (to) => {
                await bot.sendChatAction(chatFor(to), 'typing');
            },
            deliver: async (reply, to) => {
                const chat = chatFor(to);
                const chunks = splitMessage(reply.text, 3500);
                for (const [i, chunk] of chunks.entries()) {
                    const buttons =
                        i === chunks.length - 1 && reply.choices?.length
                            ? reply.choices.map((c) => ({
                                  text: c.label,
                                  callback_data: c.value.slice(0, 64),
                              }))
                            : undefined;
                    // Formatted when Telegram accepts it; plain text if it rejects the markup.
                    await bot
                        .sendMessage(chat, toTelegramHtml(chunk), buttons, 'HTML')
                        .catch((error: unknown) => {
                            if (error instanceof TelegramError && error.status === 400) {
                                return bot.sendMessage(chat, chunk, buttons);
                            }
                            throw error;
                        });
                }
                for (const file of reply.files ?? []) {
                    await bot.sendFile(chat, file.path, file.caption);
                }
            },
        };
    },
});

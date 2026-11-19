import {
    defineChannel,
    Effect,
    field,
    type Message,
    Option,
    type Picked,
    Redacted,
    secret,
    Stream,
} from '@sedge-hq/kit';
import { makeBot, splitMessage, type Update } from './bot';
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
    connect: (settings, kit) =>
        Effect.gen(function* () {
            const bot = makeBot(Redacted.value(settings.token), settings.api);
            const me = yield* bot.getMe();
            const stored = Option.getOrElse(yield* kit.memo.get('paired'), () => '[]');
            const paired = new Set<number>(JSON.parse(stored) as Array<number>);
            // In a private chat the chat id is the user's id: the user's usual conversation.
            let home = paired.values().next().value as number | undefined;
            const status = kit.status(
                paired.size > 0
                    ? `@${me.username} · paired`
                    : `@${me.username} · open the invite link to pair`,
            );
            yield* status;

            const handle = (
                update: Update,
            ): Effect.Effect<Option.Option<Message | Picked>, unknown> =>
                Effect.gen(function* () {
                    const message = update.message;
                    if (message) {
                        // Only private chats; a group the bot is in never reaches sedge.
                        if (message.chat.type !== 'private' || !message.from) return Option.none();
                        const start = /^\/start\s+(\S+)/.exec(message.text ?? '');
                        if (start && !paired.has(message.from.id)) {
                            if (yield* kit.claim(start[1]!, String(message.from.id))) {
                                paired.add(message.from.id);
                                home = message.chat.id;
                                yield* kit.memo.set('paired', JSON.stringify([...paired]));
                                yield* bot.sendMessage(
                                    message.chat.id,
                                    "Paired. I'm sedge; write to me here any time.",
                                );
                                yield* status;
                            }
                            return Option.none();
                        }
                        if (!paired.has(message.from.id)) return Option.none();
                        home = message.chat.id;
                        const text = message.text ?? message.caption;
                        if (!text) {
                            yield* bot.sendMessage(
                                message.chat.id,
                                'I can only read text for now.',
                            );
                            return Option.none();
                        }
                        return Option.some<Message | Picked>({
                            _tag: 'Message',
                            from: String(message.chat.id),
                            text,
                            key: String(update.update_id),
                        });
                    }
                    const query = update.callback_query;
                    if (query && paired.has(query.from.id)) {
                        yield* bot.answerCallbackQuery(query.id);
                        if (query.message?.text) {
                            yield* Effect.ignore(
                                bot.editMessageText(
                                    query.message.chat.id,
                                    query.message.message_id,
                                    `${query.message.text}\n\n✓`,
                                ),
                            );
                        }
                        return Option.some<Message | Picked>({
                            _tag: 'Picked',
                            from: String(query.message?.chat.id ?? query.from.id),
                            value: query.data ?? '',
                            key: String(update.update_id),
                        });
                    }
                    return Option.none();
                });

            // Long polling. The offset is saved at the start of the next poll, after the previous
            // batch went through: a crash redelivers rather than drops, and sedge drops repeats.
            let seen: number | undefined;
            const poll = Effect.gen(function* () {
                if (seen !== undefined) yield* kit.memo.set('offset', String(seen));
                const offset = Number(Option.getOrElse(yield* kit.memo.get('offset'), () => '0'));
                const updates = yield* bot.getUpdates(offset ? offset + 1 : undefined, 50);
                const events: Array<Message | Picked> = [];
                for (const update of updates) {
                    const event = yield* handle(update);
                    if (Option.isSome(event)) events.push(event.value);
                    seen = update.update_id;
                }
                return events;
            });

            const chatFor = (to?: string): Effect.Effect<number, Error> => {
                const chat = to !== undefined ? Number(to) : home;
                if (chat === undefined || !paired.has(chat)) {
                    return Effect.fail(
                        new Error('Telegram is not paired yet; open the invite link first.'),
                    );
                }
                return Effect.succeed(chat);
            };

            return {
                incoming: Stream.fromEffectRepeat(poll).pipe(
                    Stream.flatMap((events) => Stream.fromIterable(events)),
                ),
                invite: (code) => `https://t.me/${me.username}?start=${code}`,
                working: (to) =>
                    chatFor(to).pipe(Effect.flatMap((chat) => bot.sendChatAction(chat, 'typing'))),
                deliver: (reply, to) =>
                    Effect.gen(function* () {
                        const chat = yield* chatFor(to);
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
                            yield* bot
                                .sendMessage(chat, toTelegramHtml(chunk), buttons, 'HTML')
                                .pipe(
                                    Effect.catchIf(
                                        (error) => error.status === 400,
                                        () => bot.sendMessage(chat, chunk, buttons),
                                    ),
                                );
                        }
                        for (const file of reply.files ?? [])
                            yield* bot.sendFile(chat, file.path, file.caption);
                    }),
            };
        }),
});

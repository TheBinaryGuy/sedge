import { Effect, Schema } from 'effect';

/**
 * The few Bot API calls Sedge needs, over plain fetch. Updates are decoded with Schema: they are
 * untrusted input, and only the fields read here are kept.
 */

const Chat = Schema.Struct({ id: Schema.Number, type: Schema.String });
const User = Schema.Struct({
    id: Schema.Number,
    first_name: Schema.optional(Schema.String),
    username: Schema.optional(Schema.String),
});

export const Message = Schema.Struct({
    message_id: Schema.Number,
    date: Schema.Number,
    chat: Chat,
    from: Schema.optional(User),
    text: Schema.optional(Schema.String),
    caption: Schema.optional(Schema.String),
});
export type Message = typeof Message.Type;

export const CallbackQuery = Schema.Struct({
    id: Schema.String,
    from: User,
    data: Schema.optional(Schema.String),
    message: Schema.optional(
        Schema.Struct({
            message_id: Schema.Number,
            chat: Chat,
            text: Schema.optional(Schema.String),
        }),
    ),
});
export type CallbackQuery = typeof CallbackQuery.Type;

export const Update = Schema.Struct({
    update_id: Schema.Number,
    message: Schema.optional(Message),
    callback_query: Schema.optional(CallbackQuery),
});
export type Update = typeof Update.Type;

const BotUser = Schema.Struct({ id: Schema.Number, username: Schema.optional(Schema.String) });

export class TelegramError extends Schema.TaggedError<TelegramError>()('TelegramError', {
    method: Schema.String,
    message: Schema.String,
    /** Telegram's answer, when there was one. 429 asks to wait `retryAfter` seconds. */
    status: Schema.optional(Schema.Number),
    retryAfter: Schema.optional(Schema.Number),
}) {}

export interface InlineButton {
    readonly text: string;
    readonly callback_data: string;
}

/** Telegram rejects messages over 4096 characters; split on line breaks where possible. */
export const splitMessage = (text: string, limit = 4096): Array<string> => {
    const chunks: Array<string> = [];
    let rest = text;
    while (rest.length > limit) {
        const cut = rest.lastIndexOf('\n', limit);
        const at = cut > limit / 2 ? cut : limit;
        chunks.push(rest.slice(0, at));
        rest = rest.slice(at).replace(/^\n/, '');
    }
    if (rest.length > 0 || chunks.length === 0) chunks.push(rest);
    return chunks;
};

export const makeBot = (token: string, api = 'https://api.telegram.org') => {
    const call = <A>(
        method: string,
        body: Record<string, unknown>,
        decode: (value: unknown) => A,
        timeoutMs = 30_000,
    ) =>
        Effect.tryPromise({
            try: async (signal) => {
                const response = await fetch(`${api}/bot${token}/${method}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
                });
                const payload = (await response.json().catch(() => ({}))) as {
                    ok?: boolean;
                    result?: unknown;
                    description?: string;
                    parameters?: { retry_after?: number };
                };
                if (!payload.ok) {
                    throw new TelegramError({
                        method,
                        message: payload.description ?? `HTTP ${response.status}`,
                        status: response.status,
                        retryAfter: payload.parameters?.retry_after,
                    });
                }
                return decode(payload.result);
            },
            catch: (cause) =>
                cause instanceof TelegramError
                    ? cause
                    : new TelegramError({ method, message: String(cause) }),
        });

    const ignore = () => undefined;

    return {
        getMe: () => call('getMe', {}, Schema.decodeUnknownSync(BotUser)),
        /** Long poll: Telegram holds the request up to `timeout` seconds until updates arrive. */
        getUpdates: (offset: number | undefined, timeout = 50) =>
            call(
                'getUpdates',
                { offset, timeout, allowed_updates: ['message', 'callback_query'] },
                (result) =>
                    (Array.isArray(result) ? result : []).flatMap((raw) => {
                        // One malformed update must not stall the stream; keep its id so the
                        // offset still moves past it.
                        try {
                            return [Schema.decodeUnknownSync(Update)(raw)];
                        } catch {
                            const id = (raw as { update_id?: unknown })?.update_id;
                            return typeof id === 'number' ? [{ update_id: id }] : [];
                        }
                    }),
                (timeout + 10) * 1000,
            ),
        sendMessage: (
            chatId: number,
            text: string,
            buttons?: ReadonlyArray<InlineButton>,
            parseMode?: 'HTML',
        ) =>
            call(
                'sendMessage',
                {
                    chat_id: chatId,
                    text,
                    ...(parseMode ? { parse_mode: parseMode } : {}),
                    link_preview_options: { is_disabled: true },
                    ...(buttons ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
                },
                Schema.decodeUnknownSync(Schema.Struct({ message_id: Schema.Number })),
            ),
        editMessageText: (chatId: number, messageId: number, text: string) =>
            call('editMessageText', { chat_id: chatId, message_id: messageId, text }, ignore),
        answerCallbackQuery: (id: string, text?: string) =>
            call('answerCallbackQuery', { callback_query_id: id, text }, ignore),
        sendChatAction: (chatId: number, action: 'typing') =>
            call('sendChatAction', { chat_id: chatId, action }, ignore),
        /** Uploads a local file: as a photo when it is an image, otherwise as a document. */
        sendFile: (chatId: number, path: string, caption?: string) =>
            Effect.tryPromise({
                try: async (signal) => {
                    const photo = /\.(png|jpe?g|gif|webp)$/i.test(path);
                    const form = new FormData();
                    form.append('chat_id', String(chatId));
                    form.append(photo ? 'photo' : 'document', Bun.file(path));
                    if (caption) form.append('caption', caption.slice(0, 1024));
                    const method = photo ? 'sendPhoto' : 'sendDocument';
                    const response = await fetch(`${api}/bot${token}/${method}`, {
                        method: 'POST',
                        body: form,
                        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
                    });
                    const payload = (await response.json().catch(() => ({}))) as {
                        ok?: boolean;
                        description?: string;
                    };
                    if (!payload.ok) {
                        throw new TelegramError({
                            method,
                            message: payload.description ?? `HTTP ${response.status}`,
                            status: response.status,
                        });
                    }
                },
                catch: (cause) =>
                    cause instanceof TelegramError
                        ? cause
                        : new TelegramError({ method: 'sendFile', message: String(cause) }),
            }),
    };
};

export type Bot = ReturnType<typeof makeBot>;

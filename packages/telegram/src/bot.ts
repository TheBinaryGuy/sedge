/**
 * The few Bot API calls sedge needs, over plain fetch. Updates are untrusted input: only the
 * fields read here are kept, and each is checked before it's used.
 */

export interface Chat {
    readonly id: number;
    readonly type: string;
}
export interface User {
    readonly id: number;
    readonly username?: string;
}
export interface Message {
    readonly message_id: number;
    readonly chat: Chat;
    readonly from?: User;
    readonly text?: string;
    readonly caption?: string;
}
export interface CallbackQuery {
    readonly id: string;
    readonly from: User;
    readonly data?: string;
    readonly message?: { readonly message_id: number; readonly chat: Chat; readonly text?: string };
}
export interface Update {
    readonly update_id: number;
    readonly message?: Message;
    readonly callback_query?: CallbackQuery;
}

export interface InlineButton {
    readonly text: string;
    readonly callback_data: string;
}

/** A Bot API error. `status` 400 means Telegram refused the content; 429 asks to wait. */
export class TelegramError extends Error {
    constructor(
        readonly method: string,
        message: string,
        readonly status?: number,
        readonly retryAfter?: number,
    ) {
        super(`${method}: ${message}`);
    }
}

// ── Checking what Telegram sends ───────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const record = (value: unknown): Json | undefined =>
    typeof value === 'object' && value !== null ? (value as Json) : undefined;
const num = (value: unknown) => (typeof value === 'number' ? value : undefined);
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

const chat = (value: unknown): Chat | undefined => {
    const v = record(value);
    const id = num(v?.id);
    const type = str(v?.type);
    return id !== undefined && type !== undefined ? { id, type } : undefined;
};
const user = (value: unknown): User | undefined => {
    const v = record(value);
    const id = num(v?.id);
    if (id === undefined) return undefined;
    const username = str(v?.username);
    return username === undefined ? { id } : { id, username };
};
const message = (value: unknown): Message | undefined => {
    const v = record(value);
    const id = num(v?.message_id);
    const c = chat(v?.chat);
    if (id === undefined || !c) return undefined;
    const from = user(v?.from);
    const text = str(v?.text);
    const caption = str(v?.caption);
    return {
        message_id: id,
        chat: c,
        ...(from ? { from } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(caption !== undefined ? { caption } : {}),
    };
};
const callbackQuery = (value: unknown): CallbackQuery | undefined => {
    const v = record(value);
    const id = str(v?.id);
    const from = user(v?.from);
    if (id === undefined || !from) return undefined;
    const data = str(v?.data);
    const m = record(v?.message);
    const mid = num(m?.message_id);
    const mchat = chat(m?.chat);
    const mtext = str(m?.text);
    return {
        id,
        from,
        ...(data !== undefined ? { data } : {}),
        ...(mid !== undefined && mchat
            ? {
                  message: {
                      message_id: mid,
                      chat: mchat,
                      ...(mtext !== undefined ? { text: mtext } : {}),
                  },
              }
            : {}),
    };
};
/** One update; a malformed one keeps only its id, so the offset still moves past it. */
export const update = (value: unknown): Update | undefined => {
    const v = record(value);
    const id = num(v?.update_id);
    if (id === undefined) return undefined;
    const m = message(v?.message);
    const q = callbackQuery(v?.callback_query);
    return { update_id: id, ...(m ? { message: m } : {}), ...(q ? { callback_query: q } : {}) };
};

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

export const makeBot = (token: string, api = 'https://api.telegram.org', signal?: AbortSignal) => {
    const send = async (method: string, init: RequestInit, timeoutMs: number) => {
        const response = await fetch(`${api}/bot${token}/${method}`, {
            method: 'POST',
            ...init,
            signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
        });
        const payload = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            result?: unknown;
            description?: string;
            parameters?: { retry_after?: number };
        };
        if (!payload.ok) {
            throw new TelegramError(
                method,
                payload.description ?? `HTTP ${response.status}`,
                response.status,
                payload.parameters?.retry_after,
            );
        }
        return payload.result;
    };
    const call = (method: string, body: Record<string, unknown>, timeoutMs = 30_000) =>
        send(
            method,
            { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
            timeoutMs,
        );

    return {
        getMe: async () => {
            const me = user(await call('getMe', {}));
            if (!me) throw new TelegramError('getMe', 'unexpected answer');
            return me;
        },
        /** Long poll: Telegram holds the request up to `timeout` seconds until updates arrive. */
        getUpdates: async (offset: number | undefined, timeout = 50): Promise<Array<Update>> => {
            const result = await call(
                'getUpdates',
                { offset, timeout, allowed_updates: ['message', 'callback_query'] },
                (timeout + 10) * 1000,
            );
            return (Array.isArray(result) ? result : []).flatMap((raw) => {
                const u = update(raw);
                return u ? [u] : [];
            });
        },
        sendMessage: async (
            chatId: number,
            text: string,
            buttons?: ReadonlyArray<InlineButton>,
            parseMode?: 'HTML',
        ) => {
            await call('sendMessage', {
                chat_id: chatId,
                text,
                ...(parseMode ? { parse_mode: parseMode } : {}),
                link_preview_options: { is_disabled: true },
                ...(buttons ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
            });
        },
        editMessageText: async (chatId: number, messageId: number, text: string) => {
            await call('editMessageText', { chat_id: chatId, message_id: messageId, text });
        },
        answerCallbackQuery: async (id: string, text?: string) => {
            await call('answerCallbackQuery', { callback_query_id: id, text });
        },
        sendChatAction: async (chatId: number, action: 'typing') => {
            await call('sendChatAction', { chat_id: chatId, action });
        },
        /** Uploads a local file: as a photo when it is an image, otherwise as a document. */
        sendFile: async (chatId: number, path: string, caption?: string) => {
            const photo = /\.(png|jpe?g|gif|webp)$/i.test(path);
            const form = new FormData();
            form.append('chat_id', String(chatId));
            form.append(photo ? 'photo' : 'document', Bun.file(path));
            if (caption) form.append('caption', caption.slice(0, 1024));
            await send(photo ? 'sendPhoto' : 'sendDocument', { body: form }, 120_000);
        },
    };
};

export type Bot = ReturnType<typeof makeBot>;

/** A Slack Web API error: Slack's own code, such as `not_in_channel` or `invalid_auth`. */
export class SlackError extends Error {
    constructor(
        readonly method: string,
        readonly code: string,
    ) {
        super(`${method}: ${code}`);
    }
}

export const DEFAULT_API = 'https://slack.com/api';

/** Calls a Web API method with a token; Slack answers `{ ok: false, error }` rather than an HTTP error. */
export const makeSlack = (api: string, signal: AbortSignal) => {
    const call = async <A = Record<string, unknown>>(
        method: string,
        token: string,
        body: Record<string, unknown> = {},
    ): Promise<A> => {
        const response = await fetch(`${api.replace(/\/$/, '')}/${method}`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        const payload = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
        };
        if (!payload.ok) throw new SlackError(method, payload.error ?? `HTTP ${response.status}`);
        return payload as A;
    };

    /** Slack's three-step upload: ask for a URL, send the bytes, share the file in the chat. */
    const upload = async (token: string, channel: string, path: string, caption?: string) => {
        const file = Bun.file(path);
        const name = path.split('/').pop() ?? 'file';
        const form = new URLSearchParams({ filename: name, length: String(file.size) });
        const asked = await fetch(`${api.replace(/\/$/, '')}/files.getUploadURLExternal`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: form,
            signal,
        }).then(
            (r) =>
                r.json() as Promise<{
                    ok?: boolean;
                    error?: string;
                    upload_url?: string;
                    file_id?: string;
                }>,
        );
        if (!asked.ok || !asked.upload_url || !asked.file_id) {
            throw new SlackError('files.getUploadURLExternal', asked.error ?? 'no upload url');
        }
        await fetch(asked.upload_url, { method: 'POST', body: file, signal });
        await call('files.completeUploadExternal', token, {
            files: [{ id: asked.file_id, title: name }],
            channel_id: channel,
            ...(caption ? { initial_comment: caption } : {}),
        });
    };

    return { call, upload };
};

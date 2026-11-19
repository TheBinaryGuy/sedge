import type { Kit } from '@sedge-hq/kit';

export const DEFAULT_API = 'https://api.github.com';

/** A GitHub REST call with the token, through the kit (it throws on anything but a 2xx). */
export const github =
    (kit: Kit, token: string, api = DEFAULT_API) =>
    <A>(path: string) =>
        kit.fetchJson<A>(`${api.replace(/\/$/, '')}${path}`, {
            headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${token}`,
                'x-github-api-version': '2022-11-28',
                'user-agent': 'sedge',
            },
            signal: kit.signal,
        });

/**
 * When this signal was first connected. Only what happens after it is reported: connecting one
 * shouldn't flood you with last month's failures.
 */
export const since = async (kit: Kit) => {
    const saved = await kit.memo.get('since');
    if (saved) return saved;
    const now = new Date().toISOString();
    await kit.memo.set('since', now);
    return now;
};

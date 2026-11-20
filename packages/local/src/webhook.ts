import { defineSignal, field, type Happening, secret } from '@sedge-hq/kit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { clip, queue } from './queue';

const KEEP = 20_000;
/** Headers senders use to name a delivery, so a retried one is dropped. */
const DELIVERY_IDS = ['x-github-delivery', 'x-request-id', 'idempotency-key', 'webhook-id'];

const same = (a: string, b: string) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
};

/** The token as a bearer header, a `token` query parameter, or a GitHub-style body signature. */
export const authorized = (request: Request, url: URL, body: string, token: string) => {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (bearer && same(bearer, token)) return true;
    const query = url.searchParams.get('token');
    if (query && same(query, token)) return true;
    const signature = request.headers.get('x-hub-signature-256');
    if (!signature) return false;
    const expected = `sha256=${createHmac('sha256', token).update(body).digest('hex')}`;
    return same(signature, expected);
};

/** The body as data: JSON as its value, so conditions can read its fields; text otherwise. */
const bodyOf = (body: string, type: string | null): unknown => {
    if (body.length > KEEP) return clip(body, KEEP);
    if (!type?.includes('json') && !/^\s*[[{]/.test(body)) return body;
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return body;
    }
};

/** Anything that can send an HTTP POST: a home sensor, a deploy hook, a form, another service. */
export default defineSignal({
    name: 'webhook',
    summary:
        'HTTP POSTs to a local address: a sensor, a deploy hook, any service that sends webhooks',
    settings: {
        token: secret(
            'A shared secret senders must give: as "Authorization: Bearer <token>", as ?token=<token>, or as a GitHub webhook secret.',
        ),
        port: field.optional(field.number('The port to listen on. Default: 4747.')),
        host: field.optional(
            field.text(
                'The address to listen on. Default: 127.0.0.1, this machine only; use a tunnel to receive from outside.',
            ),
        ),
    },
    watch: ({ token, port, host }, kit) => {
        const received = queue<Happening>(kit.signal);
        const server = Bun.serve({
            port: port ?? 4747,
            hostname: host ?? '127.0.0.1',
            fetch: async (request) => {
                if (request.method !== 'POST') {
                    return new Response('Send a POST.\n', { status: 405 });
                }
                const url = new URL(request.url);
                const body = await request.text();
                if (!authorized(request, url, body, token)) {
                    return new Response('Unauthorized.\n', { status: 401 });
                }
                const id = DELIVERY_IDS.map((name) => request.headers.get(name)).find(Boolean);
                const event = request.headers.get('x-github-event');
                received.push({
                    text: `POST ${url.pathname}${event ? ` (${event})` : ''}`,
                    details: {
                        path: url.pathname,
                        ...(event ? { event } : {}),
                        body: bodyOf(body, request.headers.get('content-type')),
                    },
                    ...(id ? { key: id } : {}),
                });
                return new Response('Accepted.\n', { status: 202 });
            },
        });
        kit.status(`listening on ${server.url.href}`);
        kit.signal.addEventListener('abort', () => void server.stop(true));
        return received;
    },
});

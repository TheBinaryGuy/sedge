import { describe, expect, it } from 'vitest';
import { defineSignal, Effect, fetchJson, field, poll, secret, Stream } from './effect';

describe('the kit', () => {
    it('describes every setting to the user, optional ones and secrets included', () => {
        const kind = defineSignal({
            name: 'ci',
            summary: 'failing runs',
            settings: {
                repo: field.text('owner/name'),
                branch: field.optional(field.text('Default: main')),
                every: field.oneOf(['minute', 'hour'], 'How often to look'),
                token: secret('A token that can read Actions'),
            },
            watch: () => Stream.empty,
        });
        expect(kind.fields).toEqual([
            { name: 'repo', description: 'owner/name', secret: false, optional: false },
            { name: 'branch', description: 'Default: main', secret: false, optional: true },
            { name: 'every', description: 'How often to look', secret: false, optional: false },
            {
                name: 'token',
                description: 'A token that can read Actions',
                secret: true,
                optional: false,
            },
        ]);
        expect(kind.check({ repo: 'me/app', every: 'minute' })).toBeUndefined();
        expect(kind.check({ repo: 'me/app', every: 'weekly' })).toBeTypeOf('string');
    });

    it('polls: reports what each check finds, check after check', async () => {
        let round = 0;
        const check = Effect.sync(() => {
            round++;
            return [{ text: `round ${round}`, key: String(round) }];
        });
        const found = await Effect.runPromise(
            Stream.runCollect(poll('5 millis', check).pipe(Stream.take(3))),
        );
        expect([...found].map((h) => h.text)).toEqual(['round 1', 'round 2', 'round 3']);
    });

    it('fetchJson fails with the status when the answer is not a 2xx', async () => {
        const server = Bun.serve({
            port: 0,
            fetch: (request) =>
                new URL(request.url).pathname === '/ok'
                    ? Response.json({ runs: 2 })
                    : new Response('nope', { status: 404, statusText: 'Not Found' }),
        });
        try {
            expect(await Effect.runPromise(fetchJson(new URL('/ok', server.url)))).toEqual({
                runs: 2,
            });
            const failed = await Effect.runPromise(
                Effect.flip(fetchJson(new URL('/missing', server.url))),
            );
            expect(failed.message).toBe('404 Not Found: nope');
        } finally {
            void server.stop(true);
        }
    });
});

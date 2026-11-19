import type { Happening } from '@sedge-hq/kit';
import { describe, expect, it } from 'vitest';
import feed, { parseFeed } from './feed';
import page from './page';
import { pageText } from './text';

const fakeHost = () => {
    const memo = new Map<string, string>();
    const happened: Array<Happening> = [];
    return {
        happened,
        host: {
            status: () => {},
            memoGet: async (key: string) => memo.get(key),
            memoSet: async (key: string, value: string) => void memo.set(key, value),
            happened: async (h: Happening) => void happened.push(h),
            received: async () => {},
            claim: async () => false,
        },
    };
};
const until = async (check: () => boolean) => {
    for (let i = 0; i < 300 && !check(); i++) await Bun.sleep(10);
};
/** Serves each body in turn, then the last one again. */
const serve = (bodies: Array<string>) => {
    let i = 0;
    return Bun.serve({
        port: 0,
        fetch: () => new Response(bodies[Math.min(i++, bodies.length - 1)]),
    });
};

describe('web-page', () => {
    it('learns the page first, then tells you what was added when it changes', async () => {
        const server = serve([
            '<html><head><title>x</title><script>track()</script></head><body><h1>Status</h1><p>All systems normal</p></body></html>',
            '<html><body><h1>Status</h1><p>All systems normal</p><p>Degraded: API &amp; webhooks</p></body></html>',
        ]);
        const { host, happened } = fakeHost();
        const running = page.start({ url: server.url.href, minutes: 0.0002 }, host);
        await until(() => happened.length > 0);
        await running.stop();
        void server.stop(true);
        expect(happened).toHaveLength(1);
        expect(happened[0]?.text).toBe(
            `${server.url.href} changed: 1 line added, 0 removed.\nNew:\n+ Degraded: API & webhooks`,
        );
    });

    it('stays quiet about changes that don’t mention what you asked for', async () => {
        const server = serve(['<p>Price: 10</p>', '<p>Price: 12</p>', '<p>Price: 9, sale</p>']);
        const { host, happened } = fakeHost();
        const running = page.start(
            { url: server.url.href, minutes: 0.0002, contains: 'SALE' },
            host,
        );
        await until(() => happened.length > 0);
        await running.stop();
        void server.stop(true);
        expect(happened.map((h) => h.text.split('\n').at(-1))).toEqual(['+ Price: 9, sale']);
    });

    it('reads text without scripts, styles or markup', () => {
        expect(pageText('<style>a{}</style><div>One<br>Two &lt;3</div><li>Three</li>')).toBe(
            'One\nTwo <3\nThree',
        );
    });
});

describe('feed', () => {
    it('reads RSS and Atom', () => {
        expect(
            parseFeed(
                '<rss><item><title>A &amp; B</title><link>https://x/a</link><guid>a1</guid></item></rss>',
            ),
        ).toEqual([{ id: 'a1', title: 'A & B', link: 'https://x/a' }]);
        expect(
            parseFeed(
                '<feed><entry><title><![CDATA[Release 2]]></title><link href="https://x/r2"/><id>tag:r2</id></entry></feed>',
            ),
        ).toEqual([{ id: 'tag:r2', title: 'Release 2', link: 'https://x/r2' }]);
    });

    it('learns what’s posted first, then tells you about each new post once', async () => {
        const item = (id: string) =>
            `<item><title>Post ${id}</title><link>https://blog/${id}</link><guid>${id}</guid></item>`;
        const server = serve([
            `<rss>${item('1')}${item('2')}</rss>`,
            `<rss>${item('3')}${item('1')}${item('2')}</rss>`,
        ]);
        const { host, happened } = fakeHost();
        const running = feed.start({ url: server.url.href, minutes: 0.0002 }, host);
        await until(() => happened.length > 0);
        await Bun.sleep(50);
        await running.stop();
        void server.stop(true);
        expect(happened).toEqual([
            {
                text: `New on ${server.url.host}: Post 3`,
                key: '3',
                details: { url: 'https://blog/3' },
            },
        ]);
    });
});

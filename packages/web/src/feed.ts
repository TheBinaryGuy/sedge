import { defineSignal, field } from '@sedge-hq/kit';
import { decode } from './text';

interface Item {
    readonly id: string;
    readonly title: string;
    readonly link: string | undefined;
}

const tag = (block: string, name: string) => {
    const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    return match ? decode(match[1]!).trim() : undefined;
};

/** RSS items and Atom entries, newest as the feed lists them. */
export const parseFeed = (xml: string): Array<Item> => {
    const rss = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(([block]) => {
        const link = tag(block, 'link');
        return {
            id: tag(block, 'guid') ?? link ?? tag(block, 'title') ?? '',
            title: tag(block, 'title') ?? '(untitled)',
            link,
        };
    });
    const atom = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(([block]) => {
        const link = /<link\b[^>]*href="([^"]+)"/i.exec(block)?.[1];
        return {
            id: tag(block, 'id') ?? link ?? '',
            title: tag(block, 'title') ?? '(untitled)',
            link,
        };
    });
    return [...rss, ...atom].filter((item) => item.id);
};

const SEEN = 500;

/** New posts on a feed: a blog, releases, a forum, a podcast. */
export default defineSignal({
    name: 'feed',
    summary: 'new posts on an RSS or Atom feed',
    settings: {
        url: field.text('The feed’s address.'),
        minutes: field.optional(field.number('How often to look, in minutes. Default: 30.')),
    },
    every: ({ minutes }) => (minutes ?? 30) * 60_000,
    check: async ({ url }, kit) => {
        const response = await fetch(url, {
            signal: kit.signal,
            headers: { 'user-agent': 'sedge' },
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const items = parseFeed(await response.text());
        const saved = await kit.memo.get('seen');
        const seen = new Set<string>(saved ? (JSON.parse(saved) as Array<string>) : []);
        const fresh = items.filter((item) => !seen.has(item.id));
        for (const item of items) seen.add(item.id);
        await kit.memo.set('seen', JSON.stringify([...seen].slice(-SEEN)));
        kit.status(`${items.length} posts on ${new URL(url).host}`);
        // The first look only learns what's there already.
        if (saved === undefined) return [];
        return fresh.map((item) => ({
            text: `New on ${new URL(url).host}: ${item.title}`,
            key: item.id,
            details: { url: item.link },
        }));
    },
});

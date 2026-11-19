import { defineSignal, field } from '@sedge-hq/kit';
import { createHash } from 'node:crypto';
import { pageText } from './text';

const KEEP = 20_000;

/** A web page that changes: a price, a status page, release notes, a job board. */
export default defineSignal({
    name: 'web-page',
    summary: 'a web page whose text changes',
    settings: {
        url: field.text('The page to watch.'),
        minutes: field.optional(field.number('How often to look, in minutes. Default: 15.')),
        contains: field.optional(
            field.text('Only tell me when the changed page contains this text (any case).'),
        ),
    },
    every: ({ minutes }) => (minutes ?? 15) * 60_000,
    check: async ({ url, contains }, kit) => {
        const response = await fetch(url, {
            signal: kit.signal,
            headers: { 'user-agent': 'sedge' },
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const text = pageText(await response.text()).slice(0, KEEP);
        const before = await kit.memo.get('text');
        await kit.memo.set('text', text);
        kit.status(`watching ${new URL(url).host}`);
        // The first look only learns the page.
        if (before === undefined || before === text) return [];
        if (contains && !text.toLowerCase().includes(contains.toLowerCase())) return [];
        const old = new Set(before.split('\n'));
        const now = new Set(text.split('\n'));
        const added = [...now].filter((line) => !old.has(line));
        const removed = [...old].filter((line) => !now.has(line));
        return [
            {
                text: `${url} changed: ${added.length} line${added.length === 1 ? '' : 's'} added, ${removed.length} removed.${
                    added.length
                        ? `\nNew:\n${added
                              .slice(0, 8)
                              .map((l) => `+ ${l.slice(0, 200)}`)
                              .join('\n')}`
                        : ''
                }`,
                key: createHash('sha256').update(text).digest('hex').slice(0, 16),
                details: { url, removed: removed.slice(0, 8) },
            },
        ];
    },
});

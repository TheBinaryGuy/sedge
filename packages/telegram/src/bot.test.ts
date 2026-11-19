import { describe, expect, it } from 'vitest';
import { splitMessage } from './bot';

describe('splitMessage', () => {
    it('keeps every character and never exceeds the limit', () => {
        const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(i % 40)}`).join(
            '\n',
        );
        const chunks = splitMessage(text, 500);
        expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
        expect(chunks.join('\n')).toBe(text);
    });

    it('splits text with no line breaks at the limit', () => {
        expect(splitMessage('a'.repeat(1200), 500).map((c) => c.length)).toEqual([500, 500, 200]);
    });
});

describe('update', () => {
    it('keeps what an update says, and only the id of one it cannot read, so polling moves on', async () => {
        const { update } = await import('./bot');
        expect(
            update({
                update_id: 7,
                message: {
                    message_id: 1,
                    chat: { id: 42, type: 'private' },
                    from: { id: 42 },
                    text: 'hi',
                },
            }),
        ).toEqual({
            update_id: 7,
            message: {
                message_id: 1,
                chat: { id: 42, type: 'private' },
                from: { id: 42 },
                text: 'hi',
            },
        });
        expect(update({ update_id: 8, message: { chat: 'nope' } })).toEqual({ update_id: 8 });
        expect(update({ nothing: true })).toBeUndefined();
    });
});

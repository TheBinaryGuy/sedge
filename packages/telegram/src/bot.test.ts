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

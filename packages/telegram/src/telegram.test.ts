import { describe, expect, it } from 'vitest';
import telegram from './telegram';

describe('the telegram kind, as sedge sees it', () => {
    it('lists its settings, marking secrets so they are asked for in a hidden field', () => {
        expect(telegram.fields).toEqual([
            expect.objectContaining({ name: 'token', secret: true, optional: false }),
            expect.objectContaining({ name: 'api', secret: false, optional: true }),
        ]);
    });

    it('accepts settings with the secret left out, and rejects settings of the wrong type', () => {
        expect(telegram.check({})).toBeUndefined();
        expect(telegram.check({ api: 42 })).toBeTypeOf('string');
    });
});

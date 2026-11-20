import { describe, expect, it } from 'vitest';
import { checkEventOptions, parseDuration, passes } from './events';

describe('signal filters', () => {
    it('lets through what matches and nothing it should ignore, in any case', () => {
        const options = { match: 'fail|error', ignore: 'dependabot' };
        expect(passes(options, 'CI FAILED on main')).toBe(true);
        expect(passes(options, 'CI passed on main')).toBe(false);
        expect(passes(options, 'CI failed on dependabot/bump-zod')).toBe(false);
        expect(passes({}, 'anything')).toBe(true);
    });

    it('says what is wrong with a filter or batch window it can’t use', () => {
        expect(checkEventOptions({ match: '(' })).toMatch(/^match is not a regular expression/);
        expect(checkEventOptions({ batch: 'soon' })).toBe(
            'Can\'t read the batch window "soon"; use forms like 30s, 5m, 1h.',
        );
        expect(checkEventOptions({ match: 'x', batch: '5m' })).toBeUndefined();
        expect([parseDuration('30s'), parseDuration('5 minutes'), parseDuration('1h')]).toEqual([
            30_000, 300_000, 3_600_000,
        ]);
    });
});

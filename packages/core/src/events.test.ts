import { describe, expect, it } from 'vitest';
import { meets, parseCondition } from './conditions';
import { checkEventOptions, parseDuration, passes } from './events';

const reading = (details: unknown, text = 'reading') => ({ text, details });

describe('signal filters', () => {
    it('lets through what matches and nothing it should ignore, in any case', () => {
        const options = { match: 'fail|error', ignore: 'dependabot' };
        expect(passes(options, { text: 'CI FAILED on main' })).toBe(true);
        expect(passes(options, { text: 'CI passed on main' })).toBe(false);
        expect(passes(options, { text: 'CI failed on dependabot/bump-zod' })).toBe(false);
        expect(passes({}, { text: 'anything' })).toBe(true);
    });

    it('lets through only events that meet a condition on their details', () => {
        const options = { when: 'temperature > 30 and room = kitchen' };
        expect(passes(options, reading({ temperature: 31.5, room: 'Kitchen' }))).toBe(true);
        expect(passes(options, reading({ temperature: 30, room: 'kitchen' }))).toBe(false);
        expect(passes(options, reading({ temperature: 35, room: 'hall' }))).toBe(false);
        // A sensor that sends numbers as text still compares as a number.
        expect(passes(options, reading({ temperature: '31', room: 'kitchen' }))).toBe(true);
        // A reading without the field doesn't get through.
        expect(passes(options, reading({ room: 'kitchen' }))).toBe(false);
    });

    it('reads nested fields, or, quotes, contains and the event text', () => {
        const dry = parseCondition('payload.moisture < 30 or payload.status = "needs water"');
        expect(meets(dry, reading({ payload: { moisture: 24 } }))).toBe(true);
        expect(meets(dry, reading({ payload: { moisture: 45, status: 'needs water' } }))).toBe(
            true,
        );
        expect(meets(dry, reading({ payload: { moisture: 45, status: 'ok' } }))).toBe(false);

        const tagged = parseCondition('labels contains urgent and text contains deploy');
        expect(meets(tagged, reading({ labels: ['urgent', 'api'] }, 'deploy failed'))).toBe(true);
        expect(meets(tagged, reading({ labels: ['api'] }, 'deploy failed'))).toBe(false);
        expect(meets(parseCondition('status != ok'), reading({ status: 'down' }))).toBe(true);
    });

    it('says what is wrong with a filter or window it can’t use', () => {
        expect(checkEventOptions({ match: '(' })).toMatch(/^match is not a regular expression/);
        expect(checkEventOptions({ batch: 'soon' })).toBe(
            'Can\'t read the batch window "soon"; use forms like 30s, 5m, 1h.',
        );
        expect(checkEventOptions({ throttle: 'often' })).toMatch(/throttle window "often"/);
        expect(checkEventOptions({ when: 'temperature hot' })).toBe(
            'Can\'t read the condition "temperature hot": expected =, !=, >, >=, <, <= or contains after "temperature", found "hot".',
        );
        expect(checkEventOptions({ when: 'temperature > 30 and' })).toMatch(/nothing after "and"/);
        expect(checkEventOptions({ match: 'x', when: 'a >= 1', batch: '5m' })).toBeUndefined();
        expect([parseDuration('30s'), parseDuration('5 minutes'), parseDuration('1h')]).toEqual([
            30_000, 300_000, 3_600_000,
        ]);
    });
});

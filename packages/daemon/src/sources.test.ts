import type { SourceType } from '@sedge-hq/source';
import { describe, expect, it } from 'vitest';
import { resolveSecrets } from './env-file';
import { validateOptions } from './sources';

const telegramLike: SourceType = {
    summary: 'test',
    options: {
        type: 'object',
        properties: {
            token: { type: 'string', secret: true },
            allow: { type: 'array', items: { type: 'number' } },
        },
        required: ['token'],
        additionalProperties: false,
    },
};

describe('validateOptions', () => {
    it('refuses a secret passed as a plain option, so it never lands in the config', () => {
        expect(validateOptions(telegramLike, { token: '123:abc' }, new Set())).toMatch(/secret/);
        expect(
            validateOptions(telegramLike, { token: '${SEDGE_SOURCE_T_TOKEN}' }, new Set()),
        ).toBeUndefined();
    });

    it('requires required options unless the user supplies them as secrets', () => {
        expect(validateOptions(telegramLike, {}, new Set())).toMatch(/token/);
        expect(validateOptions(telegramLike, {}, new Set(['token']))).toBeUndefined();
    });

    it('refuses unknown and mistyped options', () => {
        expect(validateOptions(telegramLike, { chat: 1 }, new Set(['token']))).toMatch(
            /not an option/,
        );
        expect(validateOptions(telegramLike, { allow: ['me'] }, new Set(['token']))).toMatch(
            /array/,
        );
    });
});

describe('resolveSecrets', () => {
    it('fills references from .env and fails loudly on a missing one', () => {
        const env = new Map([['SEDGE_SOURCE_T_TOKEN', '123:abc']]);
        expect(resolveSecrets({ token: '${SEDGE_SOURCE_T_TOKEN}', allow: [1] }, env)).toEqual({
            token: '123:abc',
            allow: [1],
        });
        expect(() => resolveSecrets({ token: '${MISSING}' }, env)).toThrow(/MISSING/);
    });
});

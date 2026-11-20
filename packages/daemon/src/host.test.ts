import { describe, expect, it } from 'vitest';
import { toolPolicy } from './host';

describe('permissions by source', () => {
    it('asks before writing, the shell and MCP in a run woken by outside content', () => {
        const permissions = { bash: 'ask', write: 'allow', mcp: 'ask' } as const;
        expect(toolPolicy(permissions, 'write', false)).toBe('allow');
        expect(toolPolicy(permissions, 'write', true)).toBe('ask');
        expect(toolPolicy(permissions, 'bash', true)).toBe('ask');
        expect(toolPolicy(permissions, 'mcp__github__merge', true)).toBe('ask');
        // Reading never needs asking.
        expect(toolPolicy(permissions, 'read', true)).toBe('allow');
    });

    it('takes the stricter of the two, so allowing outside runs never loosens the rest', () => {
        const permissions = {
            bash: 'deny',
            write: 'allow',
            mcp: 'ask',
            signals: { bash: 'allow', write: 'allow', mcp: 'deny' },
        } as const;
        expect(toolPolicy(permissions, 'bash', true)).toBe('deny');
        expect(toolPolicy(permissions, 'write', true)).toBe('allow');
        expect(toolPolicy(permissions, 'mcp__x__y', true)).toBe('deny');
        expect(toolPolicy(permissions, 'mcp__x__y', false)).toBe('ask');
    });

    it('keeps the defaults when nothing is set', () => {
        expect(toolPolicy(undefined, 'write', false)).toBe('allow');
        expect(toolPolicy(undefined, 'write', true)).toBe('ask');
        expect(toolPolicy(undefined, 'bash', false)).toBe('ask');
    });
});

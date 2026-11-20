import { describe, expect, it } from 'vitest';
import { isCompiled } from './process';

describe('the compiled binary', () => {
    it('is recognised by where Bun keeps its entry, on every platform', () => {
        expect(isCompiled('/$bunfs/root/sedge')).toBe(true);
        // Windows: what Bun.main says, and the forms its paths also take.
        expect(isCompiled('B:/~BUN/root/sedge.exe')).toBe(true);
        expect(isCompiled('B:\\~BUN\\root\\sedge.exe')).toBe(true);
        expect(isCompiled('B:/%7EBUN/root/sedge.exe')).toBe(true);
    });

    it('isn’t a source checkout', () => {
        expect(isCompiled('/Users/me/sedge/apps/cli/src/main.ts')).toBe(false);
        expect(isCompiled('C:\\Users\\me\\sedge\\apps\\cli\\src\\main.ts')).toBe(false);
    });
});

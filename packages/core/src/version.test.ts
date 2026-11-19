import { describe, expect, it } from 'vitest';
import { compareVersions } from './version';

describe('compareVersions', () => {
    it('orders by major, minor, then patch numerically', () => {
        expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
        expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
        expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
    });

    it('never treats a prerelease as newer than its release', () => {
        expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    });
});

/**
 * Replaced at build time (`scripts/build.ts` passes `--define`). Running from source reports
 * `0.0.0-dev`, which the updater treats as "never update".
 */
declare const SEDGE_VERSION: string | undefined;

export const VERSION: string = typeof SEDGE_VERSION === 'string' ? SEDGE_VERSION : '0.0.0-dev';

export const isDevBuild = VERSION === '0.0.0-dev';

/** Compares two plain `major.minor.patch[-pre]` versions. Prereleases sort before releases. */
export const compareVersions = (a: string, b: string): number => {
    const parse = (v: string) => {
        const [core = '', pre] = v.split('-', 2);
        return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
    };
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < 3; i++) {
        const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
        if (diff !== 0) return Math.sign(diff);
    }
    if (left.pre === right.pre) return 0;
    if (left.pre === undefined) return 1;
    if (right.pre === undefined) return -1;
    return left.pre < right.pre ? -1 : 1;
};

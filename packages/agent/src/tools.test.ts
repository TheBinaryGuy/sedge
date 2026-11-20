import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchTools } from './tools';

/** Runs one of the search tools as the agent would, in `cwd`. */
const call = async (
    hidden: (path: string) => boolean,
    name: string,
    args: Record<string, unknown>,
    cwd: string,
) => {
    const tool = searchTools(hidden).tools!.find((t) => t.name === name)!;
    const result = (await tool.execute(args as never, { env: { cwd } } as never, {} as never)) as {
        output: ReadonlyArray<{ text?: string }>;
    };
    return result.output.map((part) => part.text ?? '').join('');
};

describe('the search tools', () => {
    it('skip what’s off limits in every file they walk, not just where they start', async () => {
        const root = await realpath(await mkdtemp(join(tmpdir(), 'sedge-search-')));
        await mkdir(join(root, 'workspace'));
        await writeFile(join(root, 'secrets.json'), '{"token":"DECOY-SECRET"}');
        await writeFile(join(root, 'workspace', 'notes.md'), 'token: fine to see');
        const hidden = (path: string) => path === join(root, 'secrets.json');
        const ws = join(root, 'workspace');

        const grep = await call(hidden, 'grep', { pattern: 'token', path: '..' }, ws);
        expect(grep).toContain('fine to see');
        expect(grep).not.toContain('DECOY-SECRET');
        const found = await call(hidden, 'find', { pattern: '**/*.json', path: '..' }, ws);
        expect(found).not.toContain('secrets.json');
        const direct = await call(
            hidden,
            'grep',
            { pattern: 'token', path: '../secrets.json' },
            ws,
        );
        expect(direct).not.toContain('DECOY-SECRET');
    });
});

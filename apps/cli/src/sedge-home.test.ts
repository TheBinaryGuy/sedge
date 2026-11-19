import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSedgeHome } from './sedge-home';

describe('isSedgeHome', () => {
    it('deletes a folder with sedge in it', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-home-'));
        await writeFile(join(dir, 'config.json'), '{}');
        expect(await isSedgeHome(dir, '/Users/someone')).toBe(true);
    });

    it('finds a standalone install by its binary', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-home-'));
        await mkdir(join(dir, 'bin'));
        await writeFile(join(dir, 'bin', 'sedge'), '');
        expect(await isSedgeHome(dir, '/Users/someone')).toBe(true);
    });

    it('leaves a folder without sedge in it', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-home-'));
        await writeFile(join(dir, 'notes.txt'), 'mine');
        expect(await isSedgeHome(dir, '/Users/someone')).toBe(false);
    });

    it('never deletes your home folder or anything above it, even with sedge files in it', async () => {
        const home = await mkdtemp(join(tmpdir(), 'sedge-user-'));
        await writeFile(join(home, 'config.json'), '{}');
        expect(await isSedgeHome(home, home)).toBe(false);
        expect(await isSedgeHome(`${home}/`, home)).toBe(false);
        expect(await isSedgeHome(dirname(home), home)).toBe(false);
        expect(await isSedgeHome('/', home)).toBe(false);
    });
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The agent's memory is a directory of files it edits with its own file tools. Only the user's
 * instructions and the two indexes are loaded into every run; individual notes and task files are
 * read when needed, which keeps the per-run overhead small.
 */
const SEEDS: Record<string, string> = {
    'instructions.md':
        '# Instructions\n\nStanding instructions from the user, loaded at the start of every run.\n',
    'notes/INDEX.md':
        '# Notes\n\nOne line per note file in this folder: what the agent has learned about the user.\n',
    'tasks/INDEX.md':
        '# Tasks\n\nOne line per ongoing task, pointing at its progress file in this folder.\n',
};

export const ensureMemory = async (dir: string) => {
    await mkdir(join(dir, 'notes'), { recursive: true });
    await mkdir(join(dir, 'tasks'), { recursive: true });
    for (const [file, seed] of Object.entries(SEEDS)) {
        await writeFile(join(dir, file), seed, { flag: 'wx' }).catch(() => undefined);
    }
};

export const readMemory = async (dir: string) => {
    const read = (file: string) => readFile(join(dir, file), 'utf8').catch(() => '');
    const [instructions, notes, tasks] = await Promise.all([
        read('instructions.md'),
        read('notes/INDEX.md'),
        read('tasks/INDEX.md'),
    ]);
    return { instructions, notes, tasks };
};

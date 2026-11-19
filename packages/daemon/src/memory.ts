import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * The agent's memory is a folder of files it organizes itself. Only MEMORY.md is loaded into every
 * run, and only its head: it is an index of what the agent knows and where, kept small so it costs
 * little and is actually followed. Everything else is read when it is needed.
 *
 * See https://www.anthropic.com/research/components-of-agent-memory: tell the agent what memory is
 * for, not how to use it; keep the injected layer small; let dreaming correct and reorganize it.
 */
export const MEMORY_INDEX = 'MEMORY.md';
const MAX_LINES = 200;
const MAX_BYTES = 25_000;

const SEED = `# Memory

What I know and where to find it. This file is loaded at the start of every run; keep it short and
link to other files in this folder for the details.
`;

const exists = (path: string) =>
    access(path).then(
        () => true,
        () => false,
    );

const filesUnder = async (dir: string, root = dir): Promise<Array<string>> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(
        entries.map((entry) =>
            entry.isDirectory()
                ? filesUnder(join(dir, entry.name), root)
                : Promise.resolve([relative(root, join(dir, entry.name))]),
        ),
    );
    return nested.flat();
};

/**
 * Creates MEMORY.md. A memory from before it existed (instructions.md, notes/, tasks/) is kept
 * where it is and listed in the new index, so nothing the agent learned is lost.
 */
export const ensureMemory = async (dir: string) => {
    await mkdir(dir, { recursive: true });
    const index = join(dir, MEMORY_INDEX);
    if (await exists(index)) return;
    const earlier = (await filesUnder(dir)).filter((file) => file.endsWith('.md')).sort();
    const listed = earlier.length
        ? `\nEarlier notes, from before this index:\n${earlier.map((file) => `- [${file}](${file})`).join('\n')}\n`
        : '';
    await writeFile(index, `${SEED}${listed}`, { flag: 'wx' }).catch(() => undefined);
};

/** The head of MEMORY.md: its first 200 lines or 25 KB, whichever is shorter. */
export const readMemoryIndex = async (dir: string) => {
    const text = await readFile(join(dir, MEMORY_INDEX), 'utf8').catch(() => '');
    const lines = text.split('\n');
    let head = lines.slice(0, MAX_LINES).join('\n');
    if (head.length > MAX_BYTES) head = head.slice(0, MAX_BYTES);
    const cut = head.length < text.trimEnd().length;
    return { head: head.trim(), cut };
};

/** What the nightly dream asks of the agent. */
export const DREAM_PROMPT = `Time to dream: nobody is waiting on you, so look back over what happened since your last dream and tidy your memory.

Use recall to read recent conversations, and check your memory against them: correct notes that turned out wrong or out of date, merge duplicates, delete what no longer matters, and write down what you learned that you could not look up again (rules you verified, with how you know; the user's preferences and standing instructions; traps to avoid). Keep MEMORY.md small: an index of what you know and where to find it, with details moved into other files and a link left behind. If little happened, change little. Don't message the user.`;

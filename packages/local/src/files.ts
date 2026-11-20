import { defineSignal, field } from '@sedge-hq/kit';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const SKIP = new Set(['node_modules', '.git']);
/** Files a snapshot keeps track of, at most. */
const LIMIT = 5_000;
const SHOWN = 20;

type Snapshot = Record<string, string>;

const expand = (path: string) => resolve(path.replace(/^~(?=$|\/)/, homedir()));

/** Each file under `root` that `glob` matches, as its size and time of last change. */
export const snapshot = async (root: string, glob: Bun.Glob): Promise<Snapshot> => {
    const found: Snapshot = {};
    let count = 0;
    const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (count >= LIMIT) return;
            if (SKIP.has(entry.name)) continue;
            const path = join(dir, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile() && glob.match(relative(root, path))) {
                const info = await stat(path).catch(() => undefined);
                if (!info) continue;
                found[relative(root, path)] = `${info.size}:${Math.round(info.mtimeMs)}`;
                count++;
            }
        }
    };
    const info = await stat(root);
    if (info.isFile()) return { [root]: `${info.size}:${Math.round(info.mtimeMs)}` };
    await walk(root);
    return found;
};

export const compare = (before: Snapshot, now: Snapshot) => ({
    created: Object.keys(now).filter((path) => !(path in before)),
    changed: Object.keys(now).filter((path) => path in before && before[path] !== now[path]),
    removed: Object.keys(before).filter((path) => !(path in now)),
});

const list = (mark: string, paths: Array<string>) => [
    ...paths.slice(0, SHOWN).map((path) => `${mark} ${path}`),
    ...(paths.length > SHOWN ? [`  … and ${paths.length - SHOWN} more`] : []),
];

/** A folder (or one file) whose files are created, changed or removed: a drop folder, a log, a build. */
export default defineSignal({
    name: 'files',
    summary: 'files created, changed or removed in a folder on this machine',
    settings: {
        path: field.text('The folder, or one file, to watch. ~ is your home folder.'),
        pattern: field.optional(
            field.text('Only files matching this glob, like "**/*.csv" or "*.log". Default: all.'),
        ),
        seconds: field.optional(field.number('How often to look, in seconds. Default: 10.')),
    },
    every: ({ seconds }) => Math.max(seconds ?? 10, 0.01) * 1000,
    check: async ({ path, pattern }, kit) => {
        const root = expand(path);
        const now = await snapshot(root, new Bun.Glob(pattern ?? '**/*'));
        const saved = await kit.memo.get('snapshot');
        await kit.memo.set('snapshot', JSON.stringify(now));
        kit.status(`watching ${Object.keys(now).length} files in ${root}`);
        // The first look only learns what's there.
        if (saved === undefined) return [];
        const { created, changed, removed } = compare(JSON.parse(saved) as Snapshot, now);
        if (created.length + changed.length + removed.length === 0) return [];
        const counts = [
            created.length ? `${created.length} created` : '',
            changed.length ? `${changed.length} changed` : '',
            removed.length ? `${removed.length} removed` : '',
        ].filter(Boolean);
        return [
            {
                text: [
                    `In ${root}: ${counts.join(', ')}.`,
                    ...list('+', created),
                    ...list('~', changed),
                    ...list('-', removed),
                ].join('\n'),
                key: createHash('sha256')
                    .update(JSON.stringify([saved, now]))
                    .digest('hex')
                    .slice(0, 16),
            },
        ];
    },
});

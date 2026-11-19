import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

/**
 * ~/.sedge/.env: the secrets sources need (bot tokens, passwords), one `NAME=value` per line. The
 * config refers to them as `${NAME}`, so the config can be shown, copied or read by the agent's
 * tools without giving anything away. Owner-only, written atomically.
 */
export const readEnvFile = async (path: string): Promise<Map<string, string>> => {
    const text = await readFile(path, 'utf8').catch(() => '');
    const entries = new Map<string, string>();
    for (const line of text.split('\n')) {
        const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
        if (match) entries.set(match[1]!, JSON.parse(match[2]!) as string);
    }
    return entries;
};

export const writeEnvFile = async (path: string, entries: ReadonlyMap<string, string>) => {
    const text = [...entries]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n');
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, text ? `${text}\n` : '', { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, path);
};

const REFERENCE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

/** Replaces `${NAME}` option values with the secret they name. */
export const resolveSecrets = (
    options: Readonly<Record<string, unknown>>,
    env: ReadonlyMap<string, string>,
): Record<string, unknown> =>
    Object.fromEntries(
        Object.entries(options).map(([key, value]) => {
            const match = typeof value === 'string' ? REFERENCE.exec(value) : null;
            if (!match) return [key, value];
            const secret = env.get(match[1]!);
            if (secret === undefined)
                throw new Error(`The secret ${match[1]} is missing from .env`);
            return [key, secret];
        }),
    );

export const isReference = (value: unknown) => typeof value === 'string' && REFERENCE.test(value);

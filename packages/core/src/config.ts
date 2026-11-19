import { Schema } from 'effect';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SedgePaths } from './paths';

const Policy = Schema.Literals(['allow', 'ask', 'deny']);
export type Policy = typeof Policy.Type;

const Connection = Schema.Struct({
    kind: Schema.String,
    settings: Schema.Record(Schema.String, Schema.Unknown),
    /** The settings kept in the keychain. */
    secrets: Schema.optional(Schema.Array(Schema.String)),
    /** For a signal: what the user wants done when it fires, in their words. */
    instruction: Schema.optional(Schema.String),
    enabled: Schema.optional(Schema.Boolean),
});
export type ConnectionEntry = typeof Connection.Type;

export const SedgeConfig = Schema.Struct({
    /** Working directory for runs that don't come from a terminal. */
    workspace: Schema.optional(Schema.String),
    /**
     * Channels and signals by name: their kind and settings. Secret settings are only named here;
     * their values are in the OS keychain.
     */
    connections: Schema.optional(Schema.Record(Schema.String, Connection)),
    /**
     * What runs nobody is watching (Telegram, timers) may do without asking. `ask` defers the call:
     * the user gets an approve/deny message and the agent retries after an approval.
     */
    permissions: Schema.optional(
        Schema.Struct({
            bash: Schema.optional(Policy),
            write: Schema.optional(Policy),
            mcp: Schema.optional(Policy),
        }),
    ),
});
export type SedgeConfig = typeof SedgeConfig.Type;

export const loadConfig = async (paths: SedgePaths): Promise<SedgeConfig> => {
    const text = await readFile(paths.config, 'utf8').catch(() => '{}');
    return Schema.decodeUnknownSync(SedgeConfig)(JSON.parse(text));
};

/** Written atomically and owner-only. */
export const saveConfig = async (paths: SedgePaths, config: SedgeConfig): Promise<void> => {
    await mkdir(dirname(paths.config), { recursive: true });
    const temp = `${paths.config}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(config, null, 4)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, paths.config);
};

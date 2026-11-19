import { Schema } from 'effect';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SedgePaths } from './paths';

const Policy = Schema.Literals(['allow', 'ask', 'deny']);
export type Policy = typeof Policy.Type;

export const SedgeConfig = Schema.Struct({
    /** Working directory for runs that don't come from a terminal. */
    workspace: Schema.optional(Schema.String),
    /**
     * Event sources by name: what they are, and their options. Secret options are `${NAME}`
     * references to ~/.sedge/.env, never the values themselves.
     */
    sources: Schema.optional(
        Schema.Record(
            Schema.String,
            Schema.Struct({
                type: Schema.String,
                description: Schema.String,
                options: Schema.Record(Schema.String, Schema.Unknown),
                enabled: Schema.optional(Schema.Boolean),
            }),
        ),
    ),
    /** Source types you registered: type name to the module file (under ~/.sedge/source-types). */
    sourceTypes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
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

/** Written atomically and owner-only: the file holds the bot token. */
export const saveConfig = async (paths: SedgePaths, config: SedgeConfig): Promise<void> => {
    await mkdir(dirname(paths.config), { recursive: true });
    const temp = `${paths.config}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(config, null, 4)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, paths.config);
};

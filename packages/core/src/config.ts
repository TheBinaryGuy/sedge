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
    /** The agent that handles what it brings; `main` when unset. */
    agent: Schema.optional(Schema.String),
    enabled: Schema.optional(Schema.Boolean),
    /** For a signal: only events whose text matches this regular expression (any case). */
    match: Schema.optional(Schema.String),
    /** For a signal: no events whose text matches this regular expression (any case). */
    ignore: Schema.optional(Schema.String),
    /** For a signal: only events that meet this condition, like `temperature > 30 and room = kitchen`. */
    when: Schema.optional(Schema.String),
    /** For a signal: after an event gets through, drop the next ones for this long (`1h`). */
    throttle: Schema.optional(Schema.String),
    /** For a signal: a cheap model reads each event first, and only wakes the agent when it should. */
    triage: Schema.optional(Schema.Boolean),
    /** For a signal: hold events this long (`30s`, `5m`) after the first, then hand them over together. */
    batch: Schema.optional(Schema.String),
});
export type ConnectionEntry = typeof Connection.Type;

const AgentEntry = Schema.Struct({
    /** What the agent is for, in the user's words; it reads this at the start of every run. */
    purpose: Schema.String,
});
export type AgentEntry = typeof AgentEntry.Type;

export const SedgeConfig = Schema.Struct({
    /** Working directory for runs that don't come from a terminal. */
    workspace: Schema.optional(Schema.String),
    /**
     * Channels and signals by name: their kind and settings. Secret settings are only named here;
     * their values are in the OS keychain.
     */
    connections: Schema.optional(Schema.Record(Schema.String, Connection)),
    /**
     * Agents besides `main`, by name: each has its own conversation and memory, handles the
     * channels and signals given to it, and talks to the others through the inbox.
     */
    agents: Schema.optional(Schema.Record(Schema.String, AgentEntry)),
    /**
     * The model that triages signals with `triage` on, as `provider/model`. The cheapest model of
     * the provider you use when unset.
     */
    triageModel: Schema.optional(Schema.String),
    /**
     * Limits on what the agents may use. Each is off unless set. When one is reached, events from
     * signals, timers and agents wait in the inbox; your own messages still get answers.
     */
    limits: Schema.optional(
        Schema.Struct({
            /** Runs per hour, for each agent with its subagents. */
            runsPerHour: Schema.optional(Schema.Number),
            /** Tokens per day, across all agents. */
            dailyTokens: Schema.optional(Schema.Number),
            /** Money per day across all agents, in the currency of the models' prices (USD). */
            dailyCost: Schema.optional(Schema.Number),
            /** Subagents one agent can have working at once. */
            subagents: Schema.optional(Schema.Number),
        }),
    ),
    /**
     * Run the daemon's commands in the OS sandbox (Seatbelt on macOS, bubblewrap on Linux) and keep
     * its file tools to the same rules. Off unless `enabled`.
     */
    sandbox: Schema.optional(
        Schema.Struct({
            enabled: Schema.optional(Schema.Boolean),
            /** Whether commands may reach the network. Default: yes. */
            network: Schema.optional(Schema.Boolean),
            /** More folders it may write to, besides the run's folder, the workspace and temp. */
            writable: Schema.optional(Schema.Array(Schema.String)),
            /** More files and folders nothing in it may read. */
            hidden: Schema.optional(Schema.Array(Schema.String)),
        }),
    ),
    /** Nightly dreaming, when the agent reviews its conversations and tidies its memory. On by default. */
    dreaming: Schema.optional(Schema.Boolean),
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

import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

/**
 * The contract between `sedge` (the client) and `sedge start` (the daemon). Both ends are built
 * from the same source, but a client can still meet an older daemon after an update, so `Hello`
 * reports the daemon's version and the client restarts a daemon that doesn't match it.
 */

export class DaemonInfo extends Schema.Class<DaemonInfo>('sedge/protocol/DaemonInfo')({
    version: Schema.String,
    pid: Schema.Number,
    startedAt: Schema.Number,
    home: Schema.String,
    /** Fingerprint of the RPC set; optional so an older daemon still answers `Hello`. */
    protocol: Schema.optional(Schema.String),
}) {}

export class DaemonStatus extends Schema.Class<DaemonStatus>('sedge/protocol/DaemonStatus')({
    info: DaemonInfo,
    /** The threads with a run going: `main`, `agent:<name>`, `cli:<dir>`, `dream`. */
    running: Schema.Array(Schema.String),
    pending: Schema.Number,
    timers: Schema.Number,
    update: Schema.NullOr(Schema.String),
}) {}

/** What a client sees while its prompt moves through the inbox and the agent run. */
export const AgentEvent = Schema.Union([
    Schema.TaggedStruct('Queued', { itemId: Schema.String, ahead: Schema.Number }),
    Schema.TaggedStruct('Started', { itemId: Schema.String }),
    Schema.TaggedStruct('TextDelta', { delta: Schema.String }),
    Schema.TaggedStruct('ThinkingDelta', { delta: Schema.String }),
    Schema.TaggedStruct('ToolStart', { toolCallId: Schema.String, name: Schema.String }),
    Schema.TaggedStruct('ToolEnd', {
        toolCallId: Schema.String,
        name: Schema.String,
        isError: Schema.Boolean,
    }),
    Schema.TaggedStruct('Finished', { itemId: Schema.String, text: Schema.String }),
]);
export type AgentEvent = typeof AgentEvent.Type;

/** A finished inbox item, whoever queued it. */
export class Completion extends Schema.Class<Completion>('sedge/protocol/Completion')({
    itemId: Schema.String,
    source: Schema.String,
    prompt: Schema.String,
    ok: Schema.Boolean,
    text: Schema.String,
}) {}

export class AgentRunError extends Schema.TaggedError<AgentRunError>()('AgentRunError', {
    message: Schema.String,
}) {}

export class UpdateInfo extends Schema.Class<UpdateInfo>('sedge/protocol/UpdateInfo')({
    current: Schema.String,
    latest: Schema.NullOr(Schema.String),
    installMethod: Schema.String,
    applied: Schema.Boolean,
}) {}

/** A setting a kind of channel or signal takes. Secrets are typed by the user, never passed. */
export class FieldInfo extends Schema.Class<FieldInfo>('sedge/protocol/FieldInfo')({
    name: Schema.String,
    description: Schema.String,
    secret: Schema.Boolean,
    optional: Schema.Boolean,
}) {}

/** A kind of channel or signal that is installed and can be connected. */
export class KindInfo extends Schema.Class<KindInfo>('sedge/protocol/KindInfo')({
    name: Schema.String,
    type: Schema.Literals(['channel', 'signal']),
    summary: Schema.String,
    fields: Schema.Array(FieldInfo),
    /** The npm package it comes from, or `yours` for a module you registered. */
    origin: Schema.String,
}) {}

/** A connected channel or signal and how it is doing. */
export class ConnectionInfo extends Schema.Class<ConnectionInfo>('sedge/protocol/ConnectionInfo')({
    name: Schema.String,
    kind: Schema.String,
    type: Schema.Literals(['channel', 'signal', 'unknown']),
    status: Schema.String,
    running: Schema.Boolean,
    instruction: Schema.NullOr(Schema.String),
    /** For a signal: only events matching this, none matching `ignore`, held `batch` long. */
    match: Schema.optional(Schema.NullOr(Schema.String)),
    ignore: Schema.optional(Schema.NullOr(Schema.String)),
    batch: Schema.optional(Schema.NullOr(Schema.String)),
    when: Schema.optional(Schema.NullOr(Schema.String)),
    throttle: Schema.optional(Schema.NullOr(Schema.String)),
    /** A cheap model reads each event first, and only wakes the agent when it should. */
    triage: Schema.optional(Schema.Boolean),
}) {}

/** An agent: `main` (sedge itself) or one you made, and how it is doing. */
export class AgentInfo extends Schema.Class<AgentInfo>('sedge/protocol/AgentInfo')({
    name: Schema.String,
    purpose: Schema.String,
    /** The channels and signals it handles. */
    connections: Schema.Array(Schema.String),
    /** Its memory folder. */
    memory: Schema.String,
    running: Schema.Boolean,
    pending: Schema.Number,
}) {}

/** One event in the inbox. */
export class InboxEntry extends Schema.Class<InboxEntry>('sedge/protocol/InboxEntry')({
    id: Schema.String,
    /** The conversation: `main`, `agent:<name>`, `cli:<dir>`, `dream`. */
    thread: Schema.String,
    source: Schema.String,
    prompt: Schema.String,
    status: Schema.String,
    createdAt: Schema.Number,
    finishedAt: Schema.NullOr(Schema.Number),
    error: Schema.NullOr(Schema.String),
    /** What came of it: the agent's answer, or why triage skipped it. */
    result: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

/** One message in the outbox. */
export class OutboxEntry extends Schema.Class<OutboxEntry>('sedge/protocol/OutboxEntry')({
    id: Schema.String,
    thread: Schema.String,
    kind: Schema.String,
    text: Schema.String,
    status: Schema.String,
    attempts: Schema.Number,
    createdAt: Schema.Number,
    sentAt: Schema.NullOr(Schema.Number),
    error: Schema.NullOr(Schema.String),
}) {}

/** A follow-up or schedule an agent set. */
export class TimerInfo extends Schema.Class<TimerInfo>('sedge/protocol/TimerInfo')({
    id: Schema.String,
    thread: Schema.String,
    name: Schema.NullOr(Schema.String),
    kind: Schema.String,
    cron: Schema.NullOr(Schema.String),
    prompt: Schema.String,
    nextRunAt: Schema.Number,
}) {}

/** A finished run: what woke it, how long it took, how it ended, and its tool calls. */
export class RunInfo extends Schema.Class<RunInfo>('sedge/protocol/RunInfo')({
    id: Schema.String,
    thread: Schema.String,
    sources: Schema.Array(Schema.String),
    events: Schema.Number,
    startedAt: Schema.Number,
    finishedAt: Schema.Number,
    ok: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
    tools: Schema.Array(
        Schema.Struct({ name: Schema.String, ms: Schema.Number, error: Schema.Boolean }),
    ),
    /** Tokens the run used, and their cost at the model's listed price (USD). */
    tokens: Schema.optional(Schema.Number),
    cost: Schema.optional(Schema.Number),
}) {}

/** One line of the daemon's log. */
export class LogEntry extends Schema.Class<LogEntry>('sedge/protocol/LogEntry')({
    t: Schema.Number,
    level: Schema.Literals(['debug', 'info', 'warn', 'error']),
    message: Schema.String,
    from: Schema.String,
}) {}

const Count = Schema.Struct({ name: Schema.String, count: Schema.Number });

/** The daemon's metrics since it started. */
export class StatsInfo extends Schema.Class<StatsInfo>('sedge/protocol/StatsInfo')({
    since: Schema.Number,
    runs: Schema.Number,
    failed: Schema.Number,
    averageSeconds: Schema.NullOr(Schema.Number),
    slowestSeconds: Schema.NullOr(Schema.Number),
    tools: Schema.Array(Count),
    events: Schema.Array(Count),
    deliveries: Schema.Array(Count),
}) {}

export class AgentError extends Schema.TaggedError<AgentError>()('AgentError', {
    message: Schema.String,
}) {}

export class ConnectionError extends Schema.TaggedError<ConnectionError>()('ConnectionError', {
    message: Schema.String,
}) {}

const Options = Schema.Record(Schema.String, Schema.Unknown);

export class SedgeRpcs extends RpcGroup.make(
    Rpc.make('Hello', { success: DaemonInfo }),
    Rpc.make('Status', { success: DaemonStatus }),
    Rpc.make('Prompt', {
        /** `agent` hands the task to that agent's conversation instead of the folder's own. */
        payload: { text: Schema.String, cwd: Schema.String, agent: Schema.optional(Schema.String) },
        success: AgentEvent,
        error: AgentRunError,
        stream: true,
    }),
    Rpc.make('Abort'),
    /** Every background run as it finishes, for the TUI's notifications. */
    Rpc.make('Watch', { success: Completion, stream: true }),
    Rpc.make('Agents', { success: Schema.Array(AgentInfo) }),
    /** Creates or changes an agent; `connections` are given to it. */
    Rpc.make('SaveAgent', {
        payload: {
            name: Schema.String,
            purpose: Schema.String,
            connections: Schema.NullOr(Schema.Array(Schema.String)),
        },
        success: AgentInfo,
        error: AgentError,
    }),
    Rpc.make('RemoveAgent', { payload: { name: Schema.String }, error: AgentError }),
    /** The latest events, newest first: one agent's (by name), or all. */
    Rpc.make('Inbox', {
        payload: { agent: Schema.NullOr(Schema.String), limit: Schema.Number },
        success: Schema.Array(InboxEntry),
    }),
    Rpc.make('Outbox', {
        payload: { agent: Schema.NullOr(Schema.String), limit: Schema.Number },
        success: Schema.Array(OutboxEntry),
    }),
    Rpc.make('Timers', {
        payload: { agent: Schema.NullOr(Schema.String) },
        success: Schema.Array(TimerInfo),
    }),
    /** Finished runs, newest first: one agent's (by name), or all. */
    Rpc.make('Runs', {
        payload: { agent: Schema.NullOr(Schema.String), limit: Schema.Number },
        success: Schema.Array(RunInfo),
    }),
    /** The daemon's log, newest first, at `level` and above. */
    Rpc.make('Logs', {
        payload: {
            level: Schema.NullOr(Schema.Literals(['debug', 'info', 'warn', 'error'])),
            limit: Schema.Number,
        },
        success: Schema.Array(LogEntry),
    }),
    Rpc.make('Stats', { success: StatsInfo }),
    Rpc.make('Connections', { success: Schema.Array(ConnectionInfo) }),
    Rpc.make('Kinds', { success: Schema.Array(KindInfo) }),
    /** Checks settings against a kind without connecting anything: a problem, or null. */
    Rpc.make('CheckSettings', {
        payload: { kind: Schema.String, settings: Options },
        success: Schema.NullOr(Schema.String),
        error: ConnectionError,
    }),
    /**
     * Connects a channel or signal. Secrets go to the OS keychain; the config only names them. A
     * channel answers with an invite link that pairs whoever opens it.
     */
    Rpc.make('Connect', {
        payload: {
            name: Schema.String,
            kind: Schema.String,
            settings: Options,
            secrets: Schema.Record(Schema.String, Schema.String),
            instruction: Schema.NullOr(Schema.String),
            match: Schema.optional(Schema.String),
            ignore: Schema.optional(Schema.String),
            batch: Schema.optional(Schema.String),
            when: Schema.optional(Schema.String),
            throttle: Schema.optional(Schema.String),
            triage: Schema.optional(Schema.Boolean),
        },
        success: Schema.Struct({ invite: Schema.NullOr(Schema.String) }),
        error: ConnectionError,
    }),
    /**
     * Changes what a signal does when it fires: its instruction, `match`, `ignore` and `when`
     * filters, `throttle` and `batch` windows, and `triage`. A field left out stays as it is; `null` clears it.
     */
    Rpc.make('UpdateSignal', {
        payload: {
            name: Schema.String,
            instruction: Schema.optional(Schema.NullOr(Schema.String)),
            match: Schema.optional(Schema.NullOr(Schema.String)),
            ignore: Schema.optional(Schema.NullOr(Schema.String)),
            batch: Schema.optional(Schema.NullOr(Schema.String)),
            when: Schema.optional(Schema.NullOr(Schema.String)),
            throttle: Schema.optional(Schema.NullOr(Schema.String)),
            triage: Schema.optional(Schema.NullOr(Schema.Boolean)),
        },
        error: ConnectionError,
    }),
    Rpc.make('Disconnect', { payload: { name: Schema.String }, error: ConnectionError }),
    /** A fresh one-time invite link for a channel (to pair another account, or re-pair). */
    Rpc.make('Invite', {
        payload: { name: Schema.String },
        success: Schema.String,
        error: ConnectionError,
    }),
    /** Registers a channel or signal module (bundled code), after the user reviewed it. */
    Rpc.make('AddKind', {
        payload: { name: Schema.String, code: Schema.String },
        success: KindInfo,
        error: ConnectionError,
    }),
    /** Picks up packages installed since the daemon started (`sedge install`). */
    Rpc.make('ReloadKinds'),
    Rpc.make('CheckUpdate', { payload: { apply: Schema.Boolean }, success: UpdateInfo }),
    /** Stops the daemon once the current run finishes; `restart` re-launches the current binary. */
    Rpc.make('Shutdown', { payload: { restart: Schema.Boolean } }),
) {}

/**
 * Changes whenever an RPC is added or removed. Dev builds all report version `0.0.0-dev`, so the
 * client also compares this to catch a daemon left running from older source.
 */
export const PROTOCOL = [...SedgeRpcs.requests.keys()].sort().join(',');

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
    /** The inbox item the agent is working on, if any. */
    running: Schema.NullOr(Schema.String),
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
}) {}

export class ConnectionError extends Schema.TaggedError<ConnectionError>()('ConnectionError', {
    message: Schema.String,
}) {}

const Options = Schema.Record(Schema.String, Schema.Unknown);

export class SedgeRpcs extends RpcGroup.make(
    Rpc.make('Hello', { success: DaemonInfo }),
    Rpc.make('Status', { success: DaemonStatus }),
    Rpc.make('Prompt', {
        payload: { text: Schema.String, cwd: Schema.String },
        success: AgentEvent,
        error: AgentRunError,
        stream: true,
    }),
    Rpc.make('Abort'),
    /** Every background run as it finishes, for the TUI's notifications. */
    Rpc.make('Watch', { success: Completion, stream: true }),
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
        },
        success: Schema.Struct({ invite: Schema.NullOr(Schema.String) }),
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

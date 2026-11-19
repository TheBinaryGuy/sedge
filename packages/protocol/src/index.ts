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
    Rpc.make('CheckUpdate', { payload: { apply: Schema.Boolean }, success: UpdateInfo }),
    /** Stops the daemon once the current run finishes; `restart` re-launches the current binary. */
    Rpc.make('Shutdown', { payload: { restart: Schema.Boolean } }),
) {}

/**
 * Changes whenever an RPC is added or removed. Dev builds all report version `0.0.0-dev`, so the
 * client also compares this to catch a daemon left running from older source.
 */
export const PROTOCOL = [...SedgeRpcs.requests.keys()].sort().join(',');

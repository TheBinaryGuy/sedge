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

/** A configured source and how it is doing. */
export class SourceInfo extends Schema.Class<SourceInfo>('sedge/protocol/SourceInfo')({
    name: Schema.String,
    type: Schema.String,
    description: Schema.String,
    status: Schema.String,
    running: Schema.Boolean,
}) {}

/** A kind of source that can be set up, with the options it takes (a JSON schema). */
export class SourceTypeInfo extends Schema.Class<SourceTypeInfo>('sedge/protocol/SourceTypeInfo')({
    name: Schema.String,
    summary: Schema.String,
    options: Schema.Unknown,
    talks: Schema.Boolean,
    sends: Schema.NullOr(Schema.String),
    /** The npm package it comes from, or `custom` for a module you registered. */
    origin: Schema.String,
}) {}

/** A source asking the user something at their computer, such as a pairing code. */
export class Question extends Schema.Class<Question>('sedge/protocol/Question')({
    id: Schema.String,
    source: Schema.String,
    title: Schema.String,
    detail: Schema.NullOr(Schema.String),
}) {}

export class SourceError extends Schema.TaggedError<SourceError>()('SourceError', {
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
    Rpc.make('Sources', { success: Schema.Array(SourceInfo) }),
    Rpc.make('SourceTypes', { success: Schema.Array(SourceTypeInfo) }),
    /** Checks options against the type and says what the source would do, without setting it up. */
    Rpc.make('PlanSource', {
        payload: { type: Schema.String, options: Options },
        success: Schema.Struct({
            does: Schema.Array(Schema.String),
            tell: Schema.NullOr(Schema.String),
        }),
        error: SourceError,
    }),
    /** Secrets are passed separately: they go to ~/.sedge/.env and the config only names them. */
    Rpc.make('AddSource', {
        payload: {
            name: Schema.String,
            type: Schema.String,
            description: Schema.String,
            options: Options,
            secrets: Schema.Record(Schema.String, Schema.String),
        },
        success: Schema.Struct({ tell: Schema.NullOr(Schema.String) }),
        error: SourceError,
    }),
    Rpc.make('RemoveSource', { payload: { name: Schema.String }, error: SourceError }),
    /** Registers a source type module (its source code), after the user reviewed it. */
    Rpc.make('AddSourceType', {
        payload: { name: Schema.String, code: Schema.String },
        success: SourceTypeInfo,
        error: SourceError,
    }),
    /** Picks up source packages installed since the daemon started. */
    Rpc.make('ReloadSourceTypes'),
    /** Questions sources are waiting on: those already open, then each new one. */
    Rpc.make('Questions', { success: Question, stream: true }),
    Rpc.make('Answer', { payload: { id: Schema.String, answer: Schema.NullOr(Schema.String) } }),
    Rpc.make('CheckUpdate', { payload: { apply: Schema.Boolean }, success: UpdateInfo }),
    /** Stops the daemon once the current run finishes; `restart` re-launches the current binary. */
    Rpc.make('Shutdown', { payload: { restart: Schema.Boolean } }),
) {}

/**
 * Changes whenever an RPC is added or removed. Dev builds all report version `0.0.0-dev`, so the
 * client also compares this to catch a daemon left running from older source.
 */
export const PROTOCOL = [...SedgeRpcs.requests.keys()].sort().join(',');

/**
 * Everything a Sedge source module sees. A source reports what happens somewhere else (a chat, a
 * folder, a device) as events, and may carry the agent's messages back. A module exports `type`,
 * which describes it and its options, and a default function that starts it:
 *
 * ```ts
 * import type { SourceApi, SourceType } from '@sedge-hq/source';
 *
 * export const type: SourceType = {
 *     summary: 'a doorbell on the network: reports when it rings',
 *     options: {
 *         type: 'object',
 *         properties: { url: { type: 'string', description: 'its state page' } },
 *         required: ['url'],
 *         additionalProperties: false,
 *     },
 * };
 *
 * export default function start(source: SourceApi) {
 *     // …watch something, then:
 *     void source.emit('rang', { text: 'Somebody rang the doorbell' });
 * }
 * ```
 */

export interface OptionSchema {
    readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    readonly description?: string;
    /** A password or token: typed by the user in a hidden field, kept in ~/.sedge/.env. */
    readonly secret?: boolean;
    readonly items?: OptionSchema;
    readonly enum?: ReadonlyArray<string>;
}

/** The options a source takes, as a JSON schema of an object. */
export interface OptionsSchema {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, OptionSchema>>;
    readonly required?: ReadonlyArray<string>;
    readonly additionalProperties?: boolean;
}

export interface Plan {
    /** What the source will do, in plain words; shown to the user before they confirm. */
    readonly does: ReadonlyArray<string>;
    /** What the agent should tell the user once it is set up (a next step, for example). */
    readonly tell?: string;
}

export interface SourceType {
    /** One line: what it reports and what it is for. Agents choose a type by it. */
    readonly summary: string;
    readonly options: OptionsSchema;
    /**
     * Its events are somebody writing to the agent: their `text` arrives as that person's message,
     * and the agent's answer goes back through the source.
     */
    readonly talks?: boolean;
    /** What it sends reaches the owner and nobody else; the module itself makes sure of that. */
    readonly toOwner?: boolean;
    /** One line for the agent on what sending through it does. Omit if it cannot send. */
    readonly sends?: string;
    /** Check what the schema cannot (throw to refuse) and say what the source will do. */
    readonly plan?: (options: Readonly<Record<string, unknown>>) => Plan;
}

export interface EmitOptions {
    /** Which conversation on the source this is (a chat id); answers go back there. */
    readonly conversation?: string;
    /** The source's own id for the event; an event with an id already seen is dropped. */
    readonly id?: string;
}

export interface Button {
    readonly label: string;
    /** Comes back as an `action` event with `{ data }` when pressed. */
    readonly data: string;
}

export interface Outgoing {
    readonly text: string;
    /** Where to deliver: the conversation an event came from, or the source's default. */
    readonly conversation?: string;
    readonly buttons?: ReadonlyArray<Button>;
}

export interface Question {
    readonly title: string;
    readonly detail?: string;
}

export interface SourceApi {
    readonly name: string;
    /** Its options, with secrets already filled in. */
    readonly options: Readonly<Record<string, unknown>>;
    /** Aborted when the source is stopped or removed. Stop all work when it fires. */
    readonly signal: AbortSignal;
    /**
     * Report an event. `event` is a short lowercase word (`message`, `changed`); `payload.text`
     * is what the agent reads first. A pressed button is reported as `action` with `{ data }`.
     */
    readonly emit: (
        event: string,
        payload: { readonly text?: string } & Readonly<Record<string, unknown>>,
        options?: EmitOptions,
    ) => Promise<void>;
    /** One line on how it is doing; shown wherever sources are listed. */
    readonly status: (line: string) => void;
    /** For a source that sends: called with each message the agent sends through it. */
    readonly onSend: (handler: (message: Outgoing) => Promise<void>) => void;
    /** Small values that survive restarts (an offset, a paired account). */
    readonly state: {
        readonly get: (key: string) => Promise<string | undefined>;
        readonly set: (key: string, value: string) => Promise<void>;
    };
    /**
     * Ask the user at their computer and wait for the answer (undefined if they decline). For
     * proving who is on the other end, such as a pairing code.
     */
    readonly ask: (question: Question) => Promise<string | undefined>;
    readonly log: (message: string) => void;
}

export type StartSource = (source: SourceApi) => void | Promise<void>;

export interface SourceModule {
    readonly type: SourceType;
    readonly default: StartSource;
}

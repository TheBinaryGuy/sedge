import {
    Cause,
    Duration,
    Effect,
    Exit,
    Fiber,
    Option,
    Schedule,
    Schema,
    SchemaAST,
    Stream,
} from 'effect';
import type { Scope } from 'effect';

/**
 * @sedge-hq/kit: build what connects sedge to the world.
 *
 * - A **signal** is something that happens: CI failed, a price moved, a page changed. It wakes the
 *   agent with the instruction the user gave for it. `watch` returns a Stream of what happened.
 * - A **channel** is a conversation with the user: Telegram, Slack, email. Their messages reach the
 *   agent; its replies, and its questions with choices, go back.
 *
 * Everything a kind needs comes from this one import: the kit, and the parts of Effect it uses
 * (`Effect`, `Stream`, `Schedule`, `Schema`, `Option`, `Redacted`, `Duration`), so a package needs
 * no `effect` dependency of its own and always matches the version sedge runs. Settings are
 * `field.*` (Effect Schemas underneath); `secret(...)` is typed by the user into a hidden field,
 * kept in the OS keychain, and given to you as a `Redacted`.
 *
 * ```ts
 * import { defineSignal, Effect, fetchJson, field, poll, Redacted, secret } from '@sedge-hq/kit';
 *
 * export default defineSignal({
 *     name: 'ci',
 *     summary: 'GitHub Actions runs that fail',
 *     settings: { repo: field.text('owner/name'), token: secret('A token that can read Actions') },
 *     watch: ({ repo, token }, kit) =>
 *         poll('1 minute', failedRuns(repo, Redacted.value(token), kit)),
 * });
 * ```
 */

const SECRET = Symbol.for('sedge.kit.secret');

/** A secret setting: typed by the user in a hidden field, kept in the OS keychain. */
export const secret = (description: string) =>
    Object.assign(Schema.RedactedFromValue(Schema.String).annotate({ description }), {
        [SECRET]: true as const,
    });

type Fields = Schema.Struct.Fields;
export type Settings<F extends Fields> = Schema.Struct<F>['Type'];

/** Something that happened. `text` is what the agent reads; `key` drops repeats. */
export interface Happening {
    readonly text: string;
    readonly key?: string;
    readonly details?: unknown;
}

/** A message from the user on a channel. `from` is who wrote, `key` drops repeats. */
export interface Message {
    readonly _tag: 'Message';
    readonly from: string;
    readonly text: string;
    readonly key?: string;
}

/** The user picked one of the choices a reply offered (approve/deny, for example). */
export interface Picked {
    readonly _tag: 'Picked';
    readonly from: string;
    readonly value: string;
    readonly key?: string;
}

/**
 * What the agent sends. `text` is Markdown; render what the channel can and fall back to plain
 * text. `choices` are buttons (or a numbered list where there are none): the one the user picks
 * comes back as `Picked`. `files` are local paths to send along, if the channel can.
 */
export interface Reply {
    readonly text: string;
    readonly choices?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    readonly files?: ReadonlyArray<{ readonly path: string; readonly caption?: string }>;
}

/** Small values that survive restarts: an offset, the accounts a channel is paired with. */
export interface Memo {
    readonly get: (key: string) => Effect.Effect<Option.Option<string>>;
    readonly set: (key: string, value: string) => Effect.Effect<void>;
}

export interface Kit {
    readonly memo: Memo;
    /** One line on how it is doing, shown wherever connections are listed. */
    readonly status: (line: string) => Effect.Effect<void>;
}

export interface ChannelKit extends Kit {
    /**
     * Someone sent a pairing code (from the link `invite` made). True when it is the code sedge is
     * waiting for: that account is the user's from now on. Codes are one-time and expire.
     */
    readonly claim: (code: string, account: string) => Effect.Effect<boolean>;
}

export interface Connection {
    /** The user's messages and picks. Only paired accounts: the channel itself checks. */
    readonly incoming: Stream.Stream<Message | Picked, unknown>;
    /** Send a reply to `to`, or to the user's usual conversation. Refuse anyone unpaired. */
    readonly deliver: (reply: Reply, to?: string) => Effect.Effect<void, unknown>;
    /** A link that pairs whoever opens it, carrying `code` (e.g. t.me/bot?start=code). */
    readonly invite: (code: string) => string;
    /**
     * Show that sedge is working on an answer (Telegram's "typing…"). Called every few seconds
     * while a run lasts; leave it out if the channel has nothing like it.
     */
    readonly working?: (to?: string) => Effect.Effect<void, unknown>;
}

interface Common<F extends Fields> {
    /** The kind's name, lowercase: `telegram`, `github-ci`. */
    readonly name: string;
    /** One line: what it is for. The agent chooses kinds by it. */
    readonly summary: string;
    readonly settings: F;
}

export interface SignalSpec<F extends Fields> extends Common<F> {
    readonly watch: (settings: Settings<F>, kit: Kit) => Stream.Stream<Happening, unknown>;
}

export interface ChannelSpec<F extends Fields> extends Common<F> {
    readonly connect: (
        settings: Settings<F>,
        kit: ChannelKit,
    ) => Effect.Effect<Connection, unknown, Scope.Scope>;
}

// ── What sedge sees ────────────────────────────────────────────────────────────────────────────
// A plugin brings its own copy of Effect, so the daemon talks to it through plain functions only.

export interface Field {
    readonly name: string;
    readonly description: string;
    readonly secret: boolean;
    readonly optional: boolean;
}

export interface Host {
    readonly status: (line: string) => void;
    readonly memoGet: (key: string) => Promise<string | undefined>;
    readonly memoSet: (key: string, value: string) => Promise<void>;
    readonly happened: (happening: Happening) => Promise<void>;
    readonly received: (event: Message | Picked) => Promise<void>;
    readonly claim: (code: string, account: string) => Promise<boolean>;
}

export interface Running {
    readonly stop: () => Promise<void>;
    readonly deliver?: (reply: Reply, to?: string) => Promise<void>;
    readonly invite?: (code: string) => Promise<string>;
    readonly working?: (to?: string) => Promise<void>;
}

export interface Plugin {
    readonly sedge: 1;
    readonly kind: 'signal' | 'channel';
    readonly name: string;
    readonly summary: string;
    readonly fields: ReadonlyArray<Field>;
    /** Checks settings (secrets may be left out); an error message, or undefined when fine. */
    readonly check: (settings: Record<string, unknown>) => string | undefined;
    readonly start: (settings: Record<string, unknown>, host: Host) => Running;
}

const fieldsOf = (settings: Fields): Array<Field> =>
    Object.entries(settings).map(([name, schema]) => ({
        name,
        description: SchemaAST.resolveDescription(schema.ast) ?? '',
        secret: SECRET in schema,
        optional: SchemaAST.isOptional(schema.ast),
    }));

/** The settings struct as a plain decoder: settings schemas need no services to decode. */
const struct = (settings: Fields) =>
    Schema.Struct(settings) as unknown as Schema.Codec<Record<string, unknown>, unknown>;

const checker = (settings: Fields, fields: ReadonlyArray<Field>) => {
    const decode = Schema.decodeUnknownExit(struct(settings));
    return (raw: Record<string, unknown>) => {
        // Secrets are typed by the user later; a stand-in lets the rest be checked now.
        const filled = { ...raw };
        for (const field of fields)
            if (field.secret && !(field.name in filled)) filled[field.name] = '•';
        const exit = decode(filled);
        return Exit.isSuccess(exit) ? undefined : Cause.pretty(exit.cause).split('\n')[0];
    };
};

const kitFor = (host: Host): Kit => ({
    memo: {
        get: (key) =>
            Effect.promise(() => host.memoGet(key)).pipe(Effect.map(Option.fromNullishOr)),
        set: (key, value) => Effect.promise(() => host.memoSet(key, value)),
    },
    status: (line) => Effect.sync(() => host.status(line)),
});

/** Restarts after a failure, ten seconds apart, saying why in the status. */
const resilient = <E>(host: Host, effect: Effect.Effect<void, E>) =>
    effect.pipe(
        Effect.tapCause((cause: Cause.Cause<E>) =>
            Effect.sync(() => host.status(`failed, retrying: ${String(Cause.squash(cause))}`)),
        ),
        Effect.retry({ schedule: Schedule.spaced('10 seconds') }),
    );

export const defineSignal = <F extends Fields>(spec: SignalSpec<F>): Plugin => {
    const fields = fieldsOf(spec.settings);
    const decode = Schema.decodeUnknownSync(struct(spec.settings));
    return {
        sedge: 1,
        kind: 'signal',
        name: spec.name,
        summary: spec.summary,
        fields,
        check: checker(spec.settings, fields),
        start: (raw, host) => {
            const settings = decode(raw) as Settings<F>;
            const fiber = Effect.runFork(
                resilient(
                    host,
                    Stream.runForEach(spec.watch(settings, kitFor(host)), (h) =>
                        Effect.promise(() => host.happened(h)),
                    ),
                ),
            );
            return { stop: () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined) };
        },
    };
};

export const defineChannel = <F extends Fields>(spec: ChannelSpec<F>): Plugin => {
    const fields = fieldsOf(spec.settings);
    const decode = Schema.decodeUnknownSync(struct(spec.settings));
    return {
        sedge: 1,
        kind: 'channel',
        name: spec.name,
        summary: spec.summary,
        fields,
        check: checker(spec.settings, fields),
        start: (raw, host) => {
            const settings = decode(raw) as Settings<F>;
            const kit: ChannelKit = {
                ...kitFor(host),
                claim: (code, account) => Effect.promise(() => host.claim(code, account)),
            };
            let current: Connection | undefined;
            const waiters: Array<(c: Connection) => void> = [];
            const ready = () =>
                current
                    ? Promise.resolve(current)
                    : new Promise<Connection>((resolve) => waiters.push(resolve));

            const fiber = Effect.runFork(
                resilient(
                    host,
                    Effect.scoped(
                        Effect.gen(function* () {
                            const connection = yield* spec.connect(settings, kit);
                            current = connection;
                            for (const wake of waiters.splice(0)) wake(connection);
                            yield* Stream.runForEach(connection.incoming, (event) =>
                                Effect.promise(() => host.received(event)),
                            );
                        }).pipe(Effect.ensuring(Effect.sync(() => (current = undefined)))),
                    ),
                ),
            );
            return {
                stop: () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined),
                deliver: async (reply, to) => Effect.runPromise((await ready()).deliver(reply, to)),
                invite: async (code) => (await ready()).invite(code),
                working: async (to) => {
                    const connection = current;
                    if (connection?.working)
                        await Effect.runPromise(Effect.ignore(connection.working(to)));
                },
            };
        },
    };
};

export const isPlugin = (value: unknown): value is Plugin =>
    typeof value === 'object' && value !== null && (value as { sedge?: unknown }).sedge === 1;

// ── Effect, through the kit ────────────────────────────────────────────────────────────────────

export { Duration, Effect, Option, Redacted, Schedule, Schema, Stream } from 'effect';
export type { Scope } from 'effect';

// ── Settings ───────────────────────────────────────────────────────────────────────────────────

/**
 * Settings fields. The description is what the user and the agent see when connecting, so write
 * it for a person. Wrap a field in `field.optional(...)` when it may be left out.
 */
export const field = {
    text: (description: string) => Schema.String.annotate({ description }),
    number: (description: string) => Schema.Number.annotate({ description }),
    flag: (description: string) => Schema.Boolean.annotate({ description }),
    list: (description: string) => Schema.Array(Schema.String).annotate({ description }),
    oneOf: <const V extends ReadonlyArray<string>>(values: V, description: string) =>
        Schema.Literals(values).annotate({ description }),
    optional: <S extends Schema.Top>(schema: S) =>
        Schema.optional(schema).annotate({
            description: SchemaAST.resolveDescription(schema.ast) ?? '',
        }),
};

// ── Helpers for watching ───────────────────────────────────────────────────────────────────────

/**
 * Runs `check` now and then every `every`, and reports what each check found: the usual shape of
 * a signal. Give each happening a `key` so one seen before isn't reported again.
 */
export const poll = <E>(
    every: Duration.Input,
    check: Effect.Effect<Iterable<Happening>, E>,
): Stream.Stream<Happening, E> =>
    Stream.fromEffectSchedule(check, Schedule.spaced(every)).pipe(
        Stream.flatMap((found) => Stream.fromIterable(found)),
    );

/** GETs (or sends `init`) and parses the JSON answer; anything but a 2xx fails with its status. */
export const fetchJson = <A = unknown>(
    url: string | URL,
    init?: RequestInit,
): Effect.Effect<A, Error> =>
    Effect.tryPromise({
        try: async () => {
            const response = await fetch(url, init);
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(
                    `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
                );
            }
            return (await response.json()) as A;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });

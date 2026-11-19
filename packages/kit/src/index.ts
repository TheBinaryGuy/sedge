import { Effect, Fiber, Redacted, Schedule, Schema, Stream } from 'effect';
import { checker, type Field, fieldsOf, type Host, type Plugin, resilient, struct } from './effect';

/**
 * @sedge-hq/kit: write what connects sedge to the world, in plain TypeScript.
 *
 * - A **signal** is something that happens elsewhere: CI failed, a feed changed, a price moved.
 *   It wakes sedge with the instruction the user gave for it.
 * - A **channel** is a conversation with the user: Telegram, Slack, email. Their messages reach
 *   sedge; its replies, and its questions with choices, go back.
 *
 * Write async functions; the kit does the rest: it decodes and checks settings, keeps secrets out
 * of files, retries what fails, stops cleanly, and drops repeats. (It's built on Effect inside;
 * `@sedge-hq/kit/effect` is the same kit for those who want to write Effect themselves.)
 *
 * ```ts
 * import { defineSignal, field, secret } from '@sedge-hq/kit';
 *
 * export default defineSignal({
 *     name: 'ci',
 *     summary: 'GitHub Actions runs that fail',
 *     settings: { repo: field.text('owner/name'), token: secret('A token that can read Actions') },
 *     every: '1 minute',
 *     check: async ({ repo, token }, kit) => {
 *         const { workflow_runs } = await kit.fetchJson<Runs>(`https://api.github.com/repos/${repo}/actions/runs?status=failure`, {
 *             headers: { authorization: `Bearer ${token}` },
 *         });
 *         return workflow_runs.map((run) => ({ text: `CI failed: ${run.name}`, key: String(run.id) }));
 *     },
 * });
 * ```
 */

export { field, secret } from './effect';
export type { Field, Plugin } from './effect';
export { isPlugin } from './effect';

// ── What flows through ─────────────────────────────────────────────────────────────────────────

/** Something that happened. `text` is what the agent reads; `key` drops repeats. */
export interface Happening {
    readonly text: string;
    readonly key?: string;
    readonly details?: unknown;
}

/** A message from the user on a channel. `from` is who wrote (their chat), `key` drops repeats. */
export interface Message {
    readonly type: 'message';
    readonly from: string;
    readonly text: string;
    readonly key?: string;
}

/** The user picked one of the choices a reply offered (approve/deny, for example). */
export interface Picked {
    readonly type: 'picked';
    readonly from: string;
    readonly value: string;
    readonly key?: string;
}

/**
 * What sedge sends. `text` is Markdown: render what the channel can, plain text otherwise.
 * `choices` are buttons (or a numbered list); the one picked comes back as `Picked`. `files` are
 * local paths to send along, if the channel can.
 */
export interface Reply {
    readonly text: string;
    readonly choices?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    readonly files?: ReadonlyArray<{ readonly path: string; readonly caption?: string }>;
}

// ── The kit your code gets ─────────────────────────────────────────────────────────────────────

export interface Kit {
    /** Small values that survive restarts: an offset, the accounts a channel paired. */
    readonly memo: {
        readonly get: (key: string) => Promise<string | undefined>;
        readonly set: (key: string, value: string) => Promise<void>;
    };
    /** One line on how it's doing, shown wherever connections are listed. */
    readonly status: (line: string) => void;
    /** `fetch` that parses the JSON answer, and throws on anything but a 2xx, with the status. */
    readonly fetchJson: <A = unknown>(url: string | URL, init?: RequestInit) => Promise<A>;
    /** Aborted when sedge stops this connection: pass it to `fetch`, check it in loops. */
    readonly signal: AbortSignal;
    /** Waits, or stops waiting when the connection stops. `'5 seconds'`, `'1 minute'`, or ms. */
    readonly sleep: (duration: Duration) => Promise<void>;
}

export interface ChannelKit extends Kit {
    /** Hand sedge something the user did: a message, or a pick. Only from paired accounts. */
    readonly receive: (event: Message | Picked) => Promise<void>;
    /**
     * Someone sent a pairing code (from your `invite` link). True when it's the code sedge is
     * waiting for: that account is the user's from now on; remember it with `memo`.
     */
    readonly claim: (code: string, account: string) => Promise<boolean>;
}

/** `'30 seconds'`, `'1 minute'`, `'2 hours'`, or milliseconds. */
export type Duration =
    | number
    | `${number} ${'millis' | 'second' | 'seconds' | 'minute' | 'minutes' | 'hour' | 'hours'}`;

const UNITS: Record<string, number> = {
    millis: 1,
    second: 1000,
    seconds: 1000,
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
};
const millis = (duration: Duration) => {
    if (typeof duration === 'number') return duration;
    const [n, unit] = duration.split(' ');
    return Number(n) * (UNITS[unit ?? ''] ?? 1);
};

const fetchJson = async <A>(url: string | URL, init?: RequestInit): Promise<A> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
        );
    }
    return (await response.json()) as A;
};

const sleep = (signal: AbortSignal) => (duration: Duration) =>
    new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(resolve, millis(duration));
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });

const kitFor = (host: Host, signal: AbortSignal): Kit => ({
    memo: { get: host.memoGet, set: host.memoSet },
    status: host.status,
    fetchJson,
    signal,
    sleep: sleep(signal),
});

// ── Settings as your code sees them ────────────────────────────────────────────────────────────

type Fields = Schema.Struct.Fields;
/** Your settings, decoded: secrets as plain strings. */
export type Settings<F extends Fields> = {
    readonly [
        K in keyof Schema.Struct<F>['Type']
    ]: Schema.Struct<F>['Type'][K] extends Redacted.Redacted<infer A>
        ? A
        : Schema.Struct<F>['Type'][K];
};

const decoder = <F extends Fields>(settings: F) => {
    const decode = Schema.decodeUnknownSync(struct(settings));
    return (raw: Record<string, unknown>) =>
        Object.fromEntries(
            Object.entries(decode(raw)).map(([key, value]) => [
                key,
                Redacted.isRedacted(value) ? Redacted.value(value) : value,
            ]),
        ) as Settings<F>;
};

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

// ── Signals ────────────────────────────────────────────────────────────────────────────────────

interface Common<F extends Fields> {
    /** The kind's name, lowercase: `telegram`, `github-ci`. */
    readonly name: string;
    /** One line: what it's for. The agent chooses kinds by it. */
    readonly summary: string;
    readonly settings: F;
}

export type SignalSpec<F extends Fields> = Common<F> &
    (
        | {
              /** How often to check: a duration, or one worked out from the settings. */
              readonly every: Duration | ((settings: Settings<F>) => Duration);
              /** Look, and return what happened. A happening with a key seen before is dropped. */
              readonly check: (
                  settings: Settings<F>,
                  kit: Kit,
              ) => Promise<Iterable<Happening>> | Iterable<Happening>;
          }
        | {
              /** For sources that push: yield each happening as it comes, until `kit.signal` aborts. */
              readonly watch: (settings: Settings<F>, kit: Kit) => AsyncIterable<Happening>;
          }
    );

export const defineSignal = <F extends Fields>(spec: SignalSpec<F>): Plugin => {
    const fields: ReadonlyArray<Field> = fieldsOf(spec.settings);
    const decode = decoder(spec.settings);
    return {
        sedge: 1,
        kind: 'signal',
        name: spec.name,
        summary: spec.summary,
        fields,
        check: checker(spec.settings, fields),
        start: (raw, host) => {
            const settings = decode(raw);
            const controller = new AbortController();
            const kit = kitFor(host, controller.signal);
            const happenings: Stream.Stream<Happening, Error> =
                'check' in spec
                    ? Stream.fromEffectSchedule(
                          Effect.tryPromise({
                              try: async () => [...(await spec.check(settings, kit))],
                              catch: toError,
                          }),
                          Schedule.spaced(
                              millis(
                                  typeof spec.every === 'function'
                                      ? spec.every(settings)
                                      : spec.every,
                              ),
                          ),
                      ).pipe(Stream.flatMap((found) => Stream.fromIterable(found)))
                    : Stream.suspend(() =>
                          Stream.fromAsyncIterable(spec.watch(settings, kit), toError),
                      );
            const fiber = Effect.runFork(
                resilient(
                    host,
                    Stream.runForEach(happenings, (h) => Effect.promise(() => host.happened(h))),
                ),
            );
            return {
                stop: async () => {
                    controller.abort();
                    await Effect.runPromise(Fiber.interrupt(fiber));
                },
            };
        },
    };
};

// ── Channels ───────────────────────────────────────────────────────────────────────────────────

export interface Connection {
    /**
     * Listen for the user, handing each message or pick to `kit.receive`, until `kit.signal`
     * aborts. If it throws, sedge connects again ten seconds later. Leave it out if your channel
     * gets messages some other way (a webhook you start in `connect`).
     */
    readonly listen?: () => Promise<void>;
    /** Send a reply to `to` (a `from` you received), or to the user's usual chat. */
    readonly deliver: (reply: Reply, to?: string) => Promise<void>;
    /** A link that pairs whoever opens it, carrying `code` (for example t.me/bot?start=code). */
    readonly invite: (code: string) => string;
    /** Show that sedge is working on an answer ("typing…"). Called every few seconds. */
    readonly working?: (to?: string) => Promise<void>;
    /** Close what `connect` opened. */
    readonly close?: () => Promise<void>;
}

export interface ChannelSpec<F extends Fields> extends Common<F> {
    /** Log in, restore what `memo` kept, and return the connection. */
    readonly connect: (settings: Settings<F>, kit: ChannelKit) => Promise<Connection>;
}

export const defineChannel = <F extends Fields>(spec: ChannelSpec<F>): Plugin => {
    const fields: ReadonlyArray<Field> = fieldsOf(spec.settings);
    const decode = decoder(spec.settings);
    return {
        sedge: 1,
        kind: 'channel',
        name: spec.name,
        summary: spec.summary,
        fields,
        check: checker(spec.settings, fields),
        start: (raw, host) => {
            const settings = decode(raw);
            const controller = new AbortController();
            const kit: ChannelKit = {
                ...kitFor(host, controller.signal),
                receive: (event) =>
                    host.received(
                        event.type === 'message'
                            ? {
                                  _tag: 'Message',
                                  from: event.from,
                                  text: event.text,
                                  ...(event.key ? { key: event.key } : {}),
                              }
                            : {
                                  _tag: 'Picked',
                                  from: event.from,
                                  value: event.value,
                                  ...(event.key ? { key: event.key } : {}),
                              },
                    ),
                claim: host.claim,
            };
            let current: Connection | undefined;
            const waiters: Array<(c: Connection) => void> = [];
            const ready = () =>
                current
                    ? Promise.resolve(current)
                    : new Promise<Connection>((resolve) => waiters.push(resolve));

            // Connect, listen, and on failure close and connect again: the Effect way, inside.
            const session = Effect.acquireRelease(
                Effect.tryPromise({ try: () => spec.connect(settings, kit), catch: toError }),
                (connection) =>
                    Effect.sync(() => {
                        if (current === connection) current = undefined;
                    }).pipe(
                        Effect.andThen(
                            Effect.promise(() => connection.close?.() ?? Promise.resolve()),
                        ),
                    ),
            ).pipe(
                Effect.tap((connection) =>
                    Effect.sync(() => {
                        current = connection;
                        for (const wake of waiters.splice(0)) wake(connection);
                    }),
                ),
                Effect.flatMap((connection) =>
                    connection.listen
                        ? Effect.tryPromise({
                              try: () => connection.listen!(),
                              catch: toError,
                          }).pipe(
                              Effect.andThen(
                                  controller.signal.aborted
                                      ? Effect.void
                                      : Effect.fail(new Error('stopped listening')),
                              ),
                          )
                        : Effect.never,
                ),
                Effect.scoped,
            );
            const fiber = Effect.runFork(resilient(host, session));
            return {
                stop: async () => {
                    controller.abort();
                    await Effect.runPromise(Fiber.interrupt(fiber));
                },
                deliver: async (reply, to) => (await ready()).deliver(reply, to),
                invite: async (code) => (await ready()).invite(code),
                working: async (to) => {
                    await current?.working?.(to).catch(() => undefined);
                },
            };
        },
    };
};

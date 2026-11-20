import { meets, parseCondition } from './conditions';

const DURATION = /^(\d+(?:\.\d+)?)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|week)s?$/i;
const UNIT_MS: Record<string, number> = {
    s: 1_000,
    sec: 1_000,
    second: 1_000,
    m: 60_000,
    min: 60_000,
    minute: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hour: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    w: 604_800_000,
    week: 604_800_000,
};

/** `30s`, `5m`, `2 hours`, `1d` in milliseconds; `undefined` for anything else. */
export const parseDuration = (text: string): number | undefined => {
    const match = DURATION.exec(text.trim());
    return match ? Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]! : undefined;
};

/** What a signal's events go through before they reach the agent. */
export interface EventOptions {
    /** Only events whose text matches this regular expression (any case). */
    readonly match?: string | undefined;
    /** No events whose text matches this regular expression (any case). */
    readonly ignore?: string | undefined;
    /** Only events that meet this condition on their details: `temperature > 30 and room = kitchen`. */
    readonly when?: string | undefined;
    /** After an event gets through, drop the next ones for this long (`10m`, `1h`). */
    readonly throttle?: string | undefined;
    /** Hold events this long (`30s`, `5m`, `1h`) after the first, and hand them over together. */
    readonly batch?: string | undefined;
}

const regex = (pattern: string) => new RegExp(pattern, 'i');

/** Why these options can't be used, or `undefined` when they can. */
export const checkEventOptions = (options: EventOptions): string | undefined => {
    for (const key of ['match', 'ignore'] as const) {
        const pattern = options[key];
        if (pattern === undefined) continue;
        try {
            regex(pattern);
        } catch (error) {
            return `${key} is not a regular expression: ${(error as Error).message}`;
        }
    }
    for (const key of ['batch', 'throttle'] as const) {
        const window = options[key];
        if (window !== undefined && parseDuration(window) === undefined) {
            return `Can't read the ${key} window "${window}"; use forms like 30s, 5m, 1h.`;
        }
    }
    if (options.when !== undefined) {
        try {
            parseCondition(options.when);
        } catch (error) {
            return `Can't read the condition "${options.when}": ${(error as Error).message}.`;
        }
    }
    return undefined;
};

/** What a signal reported: its text, and the structured details it may carry. */
export interface SignalEvent {
    readonly text: string;
    readonly details?: unknown;
}

/** The event as the agent reads it: its text, then its details as JSON. */
export const eventText = (event: SignalEvent) =>
    event.details === undefined
        ? event.text
        : `${event.text}\n${JSON.stringify(event.details, null, 2)}`;

/** Whether an event gets through `match`, `ignore` and `when`. */
export const passes = (
    options: EventOptions,
    event: SignalEvent,
    state: Readonly<Record<string, unknown>> = {},
): boolean => {
    const text = eventText(event);
    return (
        (options.match === undefined || regex(options.match).test(text)) &&
        (options.ignore === undefined || !regex(options.ignore).test(text)) &&
        (options.when === undefined || meets(parseCondition(options.when), event, state))
    );
};

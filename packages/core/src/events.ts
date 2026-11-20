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
    if (options.batch !== undefined && parseDuration(options.batch) === undefined) {
        return `Can't read the batch window "${options.batch}"; use forms like 30s, 5m, 1h.`;
    }
    return undefined;
};

/** Whether an event with this text gets through `match` and `ignore`. */
export const passes = (options: EventOptions, text: string): boolean =>
    (options.match === undefined || regex(options.match).test(text)) &&
    (options.ignore === undefined || !regex(options.ignore).test(text));

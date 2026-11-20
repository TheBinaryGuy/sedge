/** How much a note for the daemon's log matters. */
export type ReportLevel = 'info' | 'warn' | 'error';

/**
 * Writes a note at its level: `info` for news, `warn` for what's worth a look, `error` for a
 * failure. The daemon's log keeps console output at the level it was written.
 */
export const reportAt =
    (prefix: string) =>
    (message: string, level: ReportLevel = 'warn') =>
        (level === 'info' ? console.log : level === 'warn' ? console.warn : console.error)(
            `[${prefix}] ${message}`,
        );

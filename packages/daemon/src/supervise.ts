import { Cause, Duration, Effect } from 'effect';

const MAX_DELAY = Duration.minutes(1);

const describe = (cause: Cause.Cause<unknown>) => {
    const error = Cause.squash(cause);
    return error instanceof Error ? error.message : String(error);
};

/**
 * Runs one pass of a daemon loop (the inbox worker, the scheduler) over and over. A pass that fails
 * is retried after 1 s, 2 s, 4 s … up to a minute, and a success resets the delay. Only the first
 * failure in a row is logged with its full cause; repeats get one line. A failure that never
 * clears (a deleted database, a full disk) then costs a line a minute, not a disk's worth of log.
 */
export const supervise = <E, R>(name: string, pass: Effect.Effect<void, E, R>) =>
    Effect.gen(function* () {
        let failures = 0;
        while (true) {
            const exit = yield* Effect.exit(pass);
            if (exit._tag === 'Success') {
                failures = 0;
                continue;
            }
            if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.interrupt;
            failures++;
            const delay = Duration.min(Duration.seconds(2 ** (failures - 1)), MAX_DELAY);
            yield* failures === 1
                ? Effect.logError(
                      `${name} failed; retrying in ${Duration.format(delay)}`,
                      exit.cause,
                  )
                : Effect.logError(
                      `${name} failed again (${failures} in a row): ${describe(exit.cause)}; retrying in ${Duration.format(delay)}`,
                  );
            yield* Effect.sleep(delay);
        }
    });

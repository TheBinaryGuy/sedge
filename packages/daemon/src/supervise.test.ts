import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { supervise } from './supervise';

const quiet = Effect.provide(Logger.layer([]));

describe('supervise', () => {
    it.effect('backs off when a pass keeps failing instead of spinning', () =>
        Effect.gen(function* () {
            let attempts = 0;
            const failing = Effect.suspend(() => {
                attempts++;
                return Effect.fail(new Error('disk I/O error'));
            });
            const fiber = yield* Effect.forkChild(supervise('test loop', failing));

            // Retries at 1 s, 2 s, 4 s, 8 s … : five attempts in the first 15 seconds, then at
            // most one a minute. A loop without back-off would run thousands of times here.
            yield* TestClock.adjust('15 seconds');
            expect(attempts).toBe(5);
            yield* TestClock.adjust('10 minutes');
            expect(attempts).toBeLessThanOrEqual(5 + 11);

            yield* Fiber.interrupt(fiber);
        }).pipe(quiet),
    );

    it.effect('retries after 1, 2 and 4 seconds', () =>
        Effect.gen(function* () {
            let attempts = 0;
            const flaky = Effect.suspend(() => {
                attempts++;
                // Fails three times; the fourth pass runs (and keeps running).
                return attempts === 4 ? Effect.sleep('1 hour') : Effect.fail(new Error('boom'));
            });
            const fiber = yield* Effect.forkChild(supervise('test loop', flaky));
            yield* TestClock.adjust('7 seconds');
            expect(attempts).toBe(4);
            yield* Fiber.interrupt(fiber);
        }).pipe(quiet),
    );
});

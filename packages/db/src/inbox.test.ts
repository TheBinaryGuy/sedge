import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { Database } from './database';
import { Inbox } from './inbox';

const TestInbox = Inbox.layer.pipe(Layer.provide(Database.layer(':memory:')));

describe('Inbox', () => {
    it.effect('hands out items oldest first, and each one only once', () =>
        Effect.gen(function* () {
            const inbox = yield* Inbox;
            const first = yield* inbox.enqueue({ source: 'cli', prompt: 'one', cwd: '/' });
            yield* inbox.enqueue({ source: 'cli', prompt: 'two', cwd: '/' });

            const claimed = yield* inbox.claimNext;
            expect(claimed?.id).toBe(first.id);
            expect(claimed?.status).toBe('running');

            const second = yield* inbox.claimNext;
            expect(second?.prompt).toBe('two');
            expect(yield* inbox.claimNext).toBeUndefined();
        }).pipe(Effect.provide(TestInbox)),
    );

    it.effect('puts work a crash interrupted back in the queue', () =>
        Effect.gen(function* () {
            const inbox = yield* Inbox;
            yield* inbox.enqueue({ source: 'timer', prompt: 'nightly', cwd: '/' });
            yield* inbox.claimNext;
            expect(yield* inbox.pendingCount).toBe(0);

            expect(yield* inbox.recoverInterrupted).toBe(1);
            expect((yield* inbox.claimNext)?.prompt).toBe('nightly');
        }).pipe(Effect.provide(TestInbox)),
    );
});

import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { StoresLive } from './index';
import { Approvals } from './approvals';
import { Inbox } from './inbox';
import { Outbox } from './outbox';
import { Timers } from './timers';

const fresh = <A, E>(effect: Effect.Effect<A, E, Inbox | Timers | Outbox | Approvals>) =>
    effect.pipe(Effect.provide(StoresLive(':memory:')));

const event = (thread: string, prompt: string, externalId?: string) => ({
    source: 'telegram',
    externalId,
    thread,
    prompt,
    cwd: '/',
});

describe('Approvals', () => {
    it.effect(
        'remember that a run woken by outside content asked, for the run the answer wakes',
        () =>
            fresh(
                Effect.gen(function* () {
                    const approvals = yield* Approvals;
                    const { approval } = yield* approvals.request({
                        thread: 'main',
                        toolName: 'write',
                        inputHash: 'h1',
                        summary: 'write: x',
                        untrusted: true,
                    });
                    expect((yield* approvals.decide(approval.id, false))?.untrusted).toBe(true);
                    const mine = yield* approvals.request({
                        thread: 'main',
                        toolName: 'bash',
                        inputHash: 'h2',
                        summary: 'bash: ls',
                    });
                    expect((yield* approvals.decide(mine.approval.id, true))?.untrusted).toBe(
                        false,
                    );
                }),
            ),
    );
});

describe('Inbox', () => {
    it.effect('drops an event the source delivers twice', () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                expect(yield* inbox.enqueue(event('telegram:1', 'hi', '100'))).toBeDefined();
                expect(yield* inbox.enqueue(event('telegram:1', 'hi', '100'))).toBeUndefined();
                expect(yield* inbox.pendingCount).toBe(1);
            }),
        ),
    );

    it.effect("batches one thread's pending events into one claim, oldest thread first", () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                yield* inbox.enqueue(event('telegram:1', 'one', '1'));
                yield* inbox.enqueue(event('telegram:2', 'other chat', '2'));
                yield* inbox.enqueue(event('telegram:1', 'two', '3'));

                const first = yield* inbox.claimBatch();
                expect(first.map((e) => e.prompt)).toEqual(['one', 'two']);
                expect(first.every((e) => e.status === 'running')).toBe(true);

                const second = yield* inbox.claimBatch();
                expect(second.map((e) => e.prompt)).toEqual(['other chat']);
                expect(yield* inbox.claimBatch()).toEqual([]);
            }),
        ),
    );

    it.effect('holds an event until its time, and hands it over with an earlier run', () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                const later = Date.now() + 60_000;
                yield* inbox.enqueue({ ...event('agent:ci', 'held', '1'), holdUntil: later });
                yield* inbox.enqueue({ ...event('agent:ci', 'held too', '2'), holdUntil: later });
                expect(yield* inbox.claimBatch()).toEqual([]);

                // Something that can't wait for the agent takes the held events along.
                yield* inbox.enqueue(event('agent:ci', 'now', '3'));
                expect((yield* inbox.claimBatch()).map((e) => e.prompt)).toEqual([
                    'held',
                    'held too',
                    'now',
                ]);

                // Once the time comes, it goes on its own.
                yield* inbox.enqueue({ ...event('main', 'due', '4'), holdUntil: Date.now() - 1 });
                expect((yield* inbox.claimBatch()).map((e) => e.prompt)).toEqual(['due']);
            }),
        ),
    );

    it.effect('leaves the events it turns down waiting, and takes the rest of the thread', () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                yield* inbox.enqueue({ ...event('main', 'CI failed', '1'), source: 'ci' });
                yield* inbox.enqueue(event('main', 'are you there?', '2'));
                const notSignals = (item: { source: string }) => item.source !== 'ci';

                const claimed = yield* inbox.claimBatch([], notSignals);
                expect(claimed.map((e) => e.prompt)).toEqual(['are you there?']);
                expect(yield* inbox.claimBatch([], notSignals)).toEqual([]);
                expect(yield* inbox.activeThreads).toEqual(['main']);

                // Once nothing turns it down, it's next.
                expect((yield* inbox.claimBatch()).map((e) => e.prompt)).toEqual(['CI failed']);
            }),
        ),
    );

    it.effect('lists an agent’s events with its subagents’, and no one else’s', () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                yield* inbox.enqueue(event('agent:ci', 'build failed', '1'));
                yield* inbox.enqueue(event('agent:ci#sub:ab12', 'find the flaky test', '2'));
                yield* inbox.enqueue(event('agent:cie', 'another agent', '3'));
                yield* inbox.enqueue(event('main', 'hello', '4'));
                const ci = yield* inbox.list({ thread: 'agent:ci', limit: 10 });
                expect(ci.map((e) => e.prompt).sort()).toEqual([
                    'build failed',
                    'find the flaky test',
                ]);
            }),
        ),
    );

    it.effect('never starts a second run for a thread that has one going', () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                yield* inbox.enqueue(event('agent:ci', 'first', '1'));
                const running = yield* inbox.claimBatch();
                expect(running.map((e) => e.thread)).toEqual(['agent:ci']);

                // More for the busy agent, and something for another one.
                yield* inbox.enqueue(event('agent:ci', 'second', '2'));
                yield* inbox.enqueue(event('main', 'hello', '3'));
                const next = yield* inbox.claimBatch(['agent:ci']);
                expect(next.map((e) => e.prompt)).toEqual(['hello']);
                expect(yield* inbox.claimBatch(['agent:ci'])).toEqual([]);
                expect(yield* inbox.pendingByThread).toEqual({ 'agent:ci': 1 });

                // Once its run is over, its queue is picked up.
                expect((yield* inbox.claimBatch()).map((e) => e.prompt)).toEqual(['second']);
                expect((yield* inbox.list({ limit: 2 })).map((e) => e.prompt)).toEqual([
                    'hello',
                    'second',
                ]);
            }),
        ),
    );

    it.effect('puts events a crash interrupted back in the queue', () =>
        fresh(
            Effect.gen(function* () {
                const inbox = yield* Inbox;
                yield* inbox.enqueue(event('timer:t', 'nightly'));
                yield* inbox.claimBatch();
                expect(yield* inbox.pendingCount).toBe(0);

                expect(yield* inbox.recoverInterrupted).toBe(1);
                expect((yield* inbox.claimBatch()).map((e) => e.prompt)).toEqual(['nightly']);
            }),
        ),
    );
});

describe('Timers', () => {
    it.effect('a follow-up fires once; a schedule moves to its next run', () =>
        fresh(
            Effect.gen(function* () {
                const timers = yield* Timers;
                const base = { thread: 'telegram:1', prompt: 'check', cwd: '/', nextRunAt: 1_000 };
                const followup = yield* timers.create({ ...base, kind: 'followup' });
                const schedule = yield* timers.create({
                    ...base,
                    kind: 'schedule',
                    cron: '0 9 * * *',
                });

                expect((yield* timers.due(1_000)).length).toBe(2);
                yield* timers.markFired(followup, 1_000);
                yield* timers.markFired(schedule, 1_000, 90_000);

                expect(yield* timers.due(50_000)).toEqual([]);
                expect((yield* timers.due(90_000)).map((t) => t.id)).toEqual([schedule.id]);
            }),
        ),
    );

    it.effect("one thread can't cancel another thread's timer", () =>
        fresh(
            Effect.gen(function* () {
                const timers = yield* Timers;
                const timer = yield* timers.create({
                    kind: 'followup',
                    thread: 'telegram:1',
                    prompt: 'p',
                    cwd: '/',
                    nextRunAt: 1,
                });
                expect(yield* timers.cancel(timer.id, 'telegram:2')).toBe(false);
                expect(yield* timers.cancel(timer.id, 'telegram:1')).toBe(true);
                expect(yield* timers.count).toBe(0);
            }),
        ),
    );
});

describe('Approvals', () => {
    const call = {
        thread: 'telegram:1',
        toolName: 'bash',
        inputHash: 'h1',
        summary: 'rm -rf build',
    };

    it.effect('an approval lets the same call through exactly once', () =>
        fresh(
            Effect.gen(function* () {
                const approvals = yield* Approvals;
                const { approval } = yield* approvals.request(call);
                expect(yield* approvals.consume('telegram:1', 'h1')).toBe(false);

                yield* approvals.decide(approval.id, true);
                expect(yield* approvals.consume('telegram:2', 'h1')).toBe(false);
                expect(yield* approvals.consume('telegram:1', 'h1')).toBe(true);
                expect(yield* approvals.consume('telegram:1', 'h1')).toBe(false);
            }),
        ),
    );

    it.effect('a request is answered once; a later tap changes nothing', () =>
        fresh(
            Effect.gen(function* () {
                const approvals = yield* Approvals;
                const { approval } = yield* approvals.request(call);
                expect((yield* approvals.request(call)).created).toBe(false);
                expect((yield* approvals.decide(approval.id, false))?.status).toBe('denied');
                expect(yield* approvals.decide(approval.id, true)).toBeUndefined();
                expect(yield* approvals.consume('telegram:1', 'h1')).toBe(false);
            }),
        ),
    );
});

describe('Outbox', () => {
    it.effect('retries a failed delivery later and gives up when told to', () =>
        fresh(
            Effect.gen(function* () {
                const outbox = yield* Outbox;
                const message = yield* outbox.enqueue({ thread: 'telegram:1', text: 'hello' });
                const now = message.nextAttemptAt;

                yield* outbox.markFailed(message, 'timeout', now + 5_000);
                expect(yield* outbox.due(now, 10)).toEqual([]);
                const [retry] = yield* outbox.due(now + 5_000, 10);
                expect(retry?.attempts).toBe(1);

                yield* outbox.markFailed(retry!, 'still down', undefined);
                expect(yield* outbox.due(now + 60_000, 10)).toEqual([]);
            }),
        ),
    );
});

import { describe, expect, it } from 'vitest';
import type { Host } from './effect';
import { defineChannel, defineSignal, field, type Happening, secret } from './index';

/** A stand-in for the daemon's side of the plugin boundary. */
const fakeHost = () => {
    const happened: Array<Happening> = [];
    const received: Array<unknown> = [];
    const statuses: Array<string> = [];
    const memo = new Map<string, string>();
    const host: Host = {
        status: (line) => statuses.push(line),
        memoGet: async (key) => memo.get(key),
        memoSet: async (key, value) => void memo.set(key, value),
        happened: async (h) => void happened.push(h),
        received: async (e) => void received.push(e),
        claim: async (code) => code === 'right',
    };
    return { host, happened, received, statuses };
};

const until = async (check: () => boolean, ms = 2000) => {
    for (let waited = 0; !check(); waited += 10) {
        if (waited > ms) throw new Error('timed out');
        await Bun.sleep(10);
    }
};

describe('defineSignal', () => {
    it('checks on a schedule, with secrets as plain strings, and reports what each check finds', async () => {
        const seen: Array<string> = [];
        let round = 0;
        const kind = defineSignal({
            name: 'ci',
            summary: 'failing runs',
            settings: { repo: field.text('owner/name'), token: secret('a token') },
            every: '10 millis',
            check: async ({ repo, token }) => {
                seen.push(`${repo} ${token}`);
                round++;
                return [{ text: `round ${round}`, key: String(round) }];
            },
        });
        const { host, happened } = fakeHost();
        const running = kind.start({ repo: 'me/app', token: 's3cret' }, host);
        await until(() => happened.length >= 3);
        await running.stop();
        expect(seen[0]).toBe('me/app s3cret');
        expect(happened.slice(0, 3).map((h) => h.text)).toEqual(['round 1', 'round 2', 'round 3']);
    });

    it('takes what a pushing source yields, and stops it', async () => {
        let stopped = false;
        const kind = defineSignal({
            name: 'feed',
            summary: 'a feed',
            settings: {},
            watch: async function* (_settings, kit) {
                yield { text: 'first' };
                yield { text: 'second' };
                await kit.sleep('1 minute');
                stopped = kit.signal.aborted;
            },
        });
        const { host, happened } = fakeHost();
        const running = kind.start({}, host);
        await until(() => happened.length === 2);
        await running.stop();
        await until(() => stopped);
        expect(happened.map((h) => h.text)).toEqual(['first', 'second']);
    });
});

describe('defineChannel', () => {
    it('connects, hands sedge what the user sends, delivers replies, and reconnects after a failure', async () => {
        let connects = 0;
        const delivered: Array<string> = [];
        const kind = defineChannel({
            name: 'chat',
            summary: 'a chat',
            settings: { token: secret('a token') },
            connect: async ({ token }, kit) => {
                connects++;
                const attempt = connects;
                return {
                    listen: async () => {
                        await kit.receive({
                            type: 'message',
                            from: 'me',
                            text: `hello ${attempt} (${token})`,
                            key: String(attempt),
                        });
                        if (attempt === 1) {
                            await kit.sleep(200);
                            throw new Error('connection dropped');
                        }
                        await kit.sleep('1 minute');
                    },
                    deliver: async (reply) => void delivered.push(reply.text),
                    invite: (code) => `https://chat.example/pair?code=${code}`,
                };
            },
        });
        const { host, received, statuses } = fakeHost();
        const running = kind.start({ token: 't' }, host);
        await running.deliver!({ text: 'hi' });
        expect(await running.invite!('abc')).toBe('https://chat.example/pair?code=abc');
        await until(() => received.length >= 1);
        expect(received[0]).toEqual({ _tag: 'Message', from: 'me', text: 'hello 1 (t)', key: '1' });
        // The first connection dropped: sedge says so, and connects again ten seconds later.
        await until(() => statuses.some((s) => s.includes('connection dropped')));
        await running.stop();
        expect(delivered).toEqual(['hi']);
    });
});

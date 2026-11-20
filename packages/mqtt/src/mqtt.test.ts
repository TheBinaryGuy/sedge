import type { Happening } from '@sedge-hq/kit';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { createServer, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import signal, { decode } from './mqtt';

const fakeHost = () => {
    const memo = new Map<string, string>();
    const happened: Array<Happening> = [];
    const statuses: Array<string> = [];
    return {
        happened,
        statuses,
        host: {
            status: (line: string) => void statuses.push(line),
            memoGet: async (key: string) => memo.get(key),
            memoSet: async (key: string, value: string) => void memo.set(key, value),
            happened: async (h: Happening) => void happened.push(h),
            received: async () => {},
            claim: async () => false,
        },
    };
};
const until = async (what: string, check: () => boolean) => {
    for (let i = 0; i < 500; i++) {
        if (check()) return;
        await Bun.sleep(10);
    }
    throw new Error(`timed out waiting for ${what}`);
};

/** A broker in this process that wants user "home", password "basil". */
const broker = async () => {
    const aedes = await Aedes.createBroker({
        authenticate: (_client, username, password, done) =>
            done(null, username === 'home' && password?.toString() === 'basil'),
    });
    const server = createServer(aedes.handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
        url,
        close: () =>
            new Promise<void>((resolve) => {
                server.close();
                aedes.close(() => resolve());
            }),
    };
};
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

/** Publishes as another device would, at QoS 1. */
const publish = async (url: string, topic: string, payload: string, retain = false) => {
    const device = await mqtt.connectAsync(url, { username: 'home', password: 'basil' });
    await device.publishAsync(topic, payload, { qos: 1, retain });
    await device.endAsync();
};

describe('mqtt', () => {
    it('reports messages on the topics it follows, JSON laid out, and skips retained values', async () => {
        const { url, close } = await broker();
        closers.push(close);
        await publish(url, 'home/basil/soil', 'old retained value', true);
        const { host, happened, statuses } = fakeHost();
        const running = signal.start(
            { url, topics: ['home/+/soil'], username: 'home', password: 'basil' },
            host,
        );
        closers.push(() => running.stop());
        await until('the subscription', () => statuses.some((s) => s.startsWith('subscribed')));

        await publish(url, 'home/basil/soil', '{"moisture":12,"unit":"%"}');
        await publish(url, 'home/kitchen/temperature', '31');
        await publish(url, 'home/fern/soil', 'dry');
        await until('two messages', () => happened.length === 2);
        await Bun.sleep(100);

        expect(happened).toEqual([
            {
                text: 'Message on home/basil/soil',
                details: { topic: 'home/basil/soil', payload: { moisture: 12, unit: '%' } },
            },
            {
                text: 'Message on home/fern/soil',
                details: { topic: 'home/fern/soil', payload: 'dry' },
            },
        ]);
    });

    it('gets what was published while it was stopped', async () => {
        const { url, close } = await broker();
        closers.push(close);
        const { host, happened, statuses } = fakeHost();
        const settings = { url, topics: ['sensors/#'], username: 'home', password: 'basil' };
        const first = signal.start(settings, host);
        await until('the subscription', () => statuses.some((s) => s.startsWith('subscribed')));
        await first.stop();

        await publish(url, 'sensors/door', 'opened');
        const second = signal.start(settings, host);
        closers.push(() => second.stop());
        await until('the message sent while stopped', () => happened.length === 1);
        expect(happened[0]?.details).toEqual({ topic: 'sensors/door', payload: 'opened' });
    });

    it('says so when the broker turns it away', async () => {
        const { url, close } = await broker();
        closers.push(close);
        const { host, happened, statuses } = fakeHost();
        const running = signal.start(
            { url, topics: ['#'], username: 'home', password: 'wrong' },
            host,
        );
        closers.push(() => running.stop());
        await until('a failure', () => statuses.some((s) => s.startsWith('failed')));
        expect(statuses.find((s) => s.startsWith('failed'))).toMatch(/retrying in \d+s/);
        expect(happened).toEqual([]);
    });

    it('reads a number as a number, and describes binary instead of printing it', () => {
        expect(decode(new TextEncoder().encode('31.5'))).toBe(31.5);
        expect(decode(new Uint8Array([0xff, 0xfe, 0x00, 0x01]))).toBe('(4 bytes of binary)');
    });
});

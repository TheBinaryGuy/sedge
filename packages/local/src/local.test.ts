import type { Happening } from '@sedge-hq/kit';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import command from './command';
import files from './files';
import webhook from './webhook';

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
const until = async (check: () => boolean) => {
    for (let i = 0; i < 500 && !check(); i++) await Bun.sleep(10);
};
const freePort = () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port!;
    void probe.stop(true);
    return port;
};

describe('webhook', () => {
    it('turns an authorized POST into an event, and turns away the rest', async () => {
        const port = freePort();
        const { host, happened } = fakeHost();
        const running = webhook.start({ token: 's3cret', port }, host);
        const url = `http://127.0.0.1:${port}/deploy`;
        let ready = false;
        await until(() => {
            void fetch(url, { method: 'GET' }).then(
                () => (ready = true),
                () => {},
            );
            return ready;
        });

        const wrong = await fetch(url, {
            method: 'POST',
            headers: { authorization: 'Bearer nope' },
            body: 'x',
        });
        const right = await fetch(url, {
            method: 'POST',
            headers: {
                authorization: 'Bearer s3cret',
                'content-type': 'application/json',
                'x-request-id': 'r1',
            },
            body: '{"service":"api","status":"deployed"}',
        });
        const body = 'payload';
        const signed = await fetch(`http://127.0.0.1:${port}/github`, {
            method: 'POST',
            headers: {
                'x-hub-signature-256': `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`,
                'x-github-event': 'push',
            },
            body,
        });
        await until(() => happened.length === 2);
        await running.stop();

        expect([wrong.status, right.status, signed.status]).toEqual([401, 202, 202]);
        expect(happened[0]).toEqual({
            text: 'POST /deploy',
            details: { path: '/deploy', body: { service: 'api', status: 'deployed' } },
            key: 'r1',
        });
        expect(happened[1]).toEqual({
            text: 'POST /github (push)',
            details: { path: '/github', event: 'push', body: 'payload' },
        });
    });
});

describe('files', () => {
    it('learns the folder first, then tells you what changed, also while it was stopped', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-files-'));
        await writeFile(join(dir, 'keep.csv'), 'a');
        await writeFile(join(dir, 'old.csv'), 'a');
        await writeFile(join(dir, 'notes.txt'), 'a');
        const { host, happened, statuses } = fakeHost();
        const settings = { path: dir, pattern: '*.csv', seconds: 0.05 };
        const first = files.start(settings, host);
        await until(() => statuses.length > 0);
        await first.stop();
        expect(happened).toEqual([]);

        // Changed while sedge was stopped: the next look finds all of it at once.
        await writeFile(join(dir, 'keep.csv'), 'ab');
        await writeFile(join(dir, 'new.csv'), 'a');
        await writeFile(join(dir, 'notes.txt'), 'changed, but not a csv');
        await rm(join(dir, 'old.csv'));
        const second = files.start(settings, host);
        await until(() => happened.length > 0);
        await second.stop();

        expect(happened).toHaveLength(1);
        expect(happened[0]?.text).toBe(
            `In ${dir}: 1 created, 1 changed, 1 removed.\n+ new.csv\n~ keep.csv\n- old.csv`,
        );
    });
});

// The commands are POSIX shell.
describe.skipIf(process.platform === 'win32')('command', () => {
    it('reports each burst of lines a long-running command prints', async () => {
        const { host, happened } = fakeHost();
        const running = command.start(
            {
                command:
                    'echo "temp 21"; sleep 1; echo "temp 35"; sleep 0.05; echo "humidity 80"; sleep 5',
            },
            host,
        );
        await until(() => happened.length === 2);
        await running.stop();
        expect(happened.map((h) => h.text)).toEqual(['temp 21', 'temp 35\nhumidity 80']);
    });

    it('on a schedule, reports only when the output changes', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sedge-command-'));
        const file = join(dir, 'status');
        await writeFile(file, 'ok');
        const { host, happened, statuses } = fakeHost();
        const running = command.start({ command: `cat ${file}`, minutes: 0.001, cwd: dir }, host);
        await until(() => statuses.length >= 3);
        expect(happened).toEqual([]);
        await writeFile(file, 'degraded');
        await until(() => happened.length > 0);
        await running.stop();
        expect(happened[0]?.text).toBe(`\`cat ${file}\` printed something new (exit 0):\ndegraded`);
    });
});

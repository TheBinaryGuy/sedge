import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bubblewrapArgs, sandboxedEnv, sandboxPolicy } from './sandbox';

const made: Array<string> = [];
afterAll(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** A run folder, a folder outside it, and a secret folder, under one fresh directory. */
const layout = async (network = true) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'sedge-sandbox-')));
    // Outside temp, which the sandbox lets anything write: under the home folder.
    const home = await realpath(
        await mkdtemp(join(process.env.HOME ?? root, '.sedge-sandbox-test-')),
    );
    made.push(root, home);
    const run = join(root, 'run');
    const outside = join(home, 'outside');
    const secret = join(home, 'secret');
    await Promise.all([mkdir(run), mkdir(outside), mkdir(secret)]);
    await writeFile(join(secret, 'key'), 'hunter2');
    const sandbox = sandboxPolicy({ network, hidden: [secret] }, { writable: [], hidden: [] });
    const env = sandboxedEnv(new NodeExecutionEnv({ cwd: run }), sandbox.forRun(run));
    return { run, outside, secret, sandbox, env };
};

const sh = async (env: ReturnType<typeof sandboxedEnv>, command: string) => {
    let output = '';
    const result = await env.exec(
        command,
        { onOutput: (text) => void (output += text), timeout: 20 },
        ctx,
    );
    return {
        exitCode: result.ok ? result.value.exitCode : -1,
        output,
        error: result.ok ? undefined : result.error.message,
    };
};

describe('the sandbox, for file tools', () => {
    it('writes in the run’s folder, and nowhere else', async () => {
        const { run, outside, env } = await layout();
        expect((await env.writeFile(join(run, 'a.txt'), 'ok', ctx)).ok).toBe(true);
        const refused = await env.writeFile(join(outside, 'b.txt'), 'no', ctx);
        expect(refused.ok).toBe(false);
        expect(refused.ok ? '' : refused.error.message).toMatch(/doesn't let tools write/);
        expect(existsSync(join(outside, 'b.txt'))).toBe(false);
    });

    // Making a symbolic link on Windows needs rights a test runner may not have.
    it.skipIf(process.platform === 'win32')(
        'reads nothing hidden, also through a link from the run’s folder',
        async () => {
            const { run, secret, env, sandbox } = await layout();
            const direct = await env.readTextFile(join(secret, 'key'), ctx);
            expect(direct.ok).toBe(false);
            await symlink(secret, join(run, 'innocent'));
            const linked = await env.readTextFile(join(run, 'innocent', 'key'), ctx);
            expect(linked.ok).toBe(false);
            expect(sandbox.isHidden(join(run, 'innocent', 'key'))).toBe(true);
        },
    );

    it.skipIf(process.platform === 'win32')(
        'doesn’t write through a link that leads outside',
        async () => {
            const { run, outside, env } = await layout();
            await symlink(outside, join(run, 'escape'));
            expect((await env.writeFile(join(run, 'escape', 'x.txt'), 'no', ctx)).ok).toBe(false);
            expect(existsSync(join(outside, 'x.txt'))).toBe(false);
        },
    );
});

describe.skipIf(process.platform !== 'darwin')('the sandbox, for commands on macOS', () => {
    it('lets a command write in the run’s folder, but not elsewhere or read what’s hidden', async () => {
        const { run, outside, secret, env } = await layout();
        const inside = await sh(env, 'echo made > made.txt && cat made.txt');
        expect(inside).toMatchObject({ exitCode: 0 });
        expect(await readFile(join(run, 'made.txt'), 'utf8')).toBe('made\n');

        const escape = await sh(env, `echo no > ${join(outside, 'escaped.txt')}`);
        expect(escape.exitCode).not.toBe(0);
        expect(existsSync(join(outside, 'escaped.txt'))).toBe(false);

        const peek = await sh(env, `cat ${join(secret, 'key')}`);
        expect(peek.exitCode).not.toBe(0);
        expect(peek.output).not.toContain('hunter2');
    });

    it('keeps a command off the network when network is off', async () => {
        const server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: () => new Response('hi'),
        });
        const url = `http://127.0.0.1:${server.port}/`;
        const closed = await layout(false);
        const open = await layout(true);
        const blocked = await sh(closed.env, `curl -s -m 5 ${url}`);
        const allowed = await sh(open.env, `curl -s -m 5 ${url}`);
        void server.stop(true);
        expect(blocked.exitCode).not.toBe(0);
        expect(allowed).toMatchObject({ exitCode: 0, output: 'hi' });
    });
});

const hasBwrap = (process.env.PATH ?? '').split(':').some((dir) => existsSync(join(dir, 'bwrap')));

describe.skipIf(process.platform !== 'linux' || !hasBwrap)(
    'the sandbox, for commands on Linux',
    () => {
        it('lets a command write in the run’s folder, but not elsewhere or read what’s hidden', async () => {
            const { run, outside, secret, env } = await layout();
            expect(await sh(env, 'echo made > made.txt')).toMatchObject({ exitCode: 0 });
            expect(await readFile(join(run, 'made.txt'), 'utf8')).toBe('made\n');
            expect((await sh(env, `echo no > ${join(outside, 'escaped.txt')}`)).exitCode).not.toBe(
                0,
            );
            const peek = await sh(env, `cat ${join(secret, 'key')}`);
            expect(peek.output).not.toContain('hunter2');
        });
    },
);

describe('bubblewrap arguments', () => {
    it('hides folders and files, and cuts the network only when asked', async () => {
        const { run, secret, sandbox } = await layout(false);
        const policy = sandbox.forRun(run);
        const args = bubblewrapArgs(policy, run);
        expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
        expect(args.join(' ')).toContain(`--tmpfs ${secret}`);
        expect(args.join(' ')).toContain(`--bind ${run} ${run}`);
        expect(args).toContain('--unshare-net');
        expect(bubblewrapArgs({ ...policy, network: true }, run)).not.toContain('--unshare-net');
    });
});

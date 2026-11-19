/*
 * End to end, with a fake Telegram: `bun run e2e:telegram` from the repo root.
 *
 * Starts a fake Bot API server and a daemon from source in a throwaway home, then walks the whole
 * path a user takes: install the Telegram source package, set the source up (the token must land
 * in .env, not the config), pair an account with the code the bot sends, message the agent and get
 * an answer in the chat, and approve a shell command from the chat's buttons. The last two steps
 * call the model through your pi credentials. Exits non-zero on the first failure.
 *
 * SEDGE_BIN=dist/npm/sedge-<os>-<cpu>/bin/sedge runs the same walk against a compiled binary.
 */
import { sedgePaths } from '@sedge-hq/core';
import { Effect, Fiber, Stream } from 'effect';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Daemon, DaemonLive, waitUntil } from '../src/client';

const root = resolve(import.meta.dir, '../../..');
const home = await mkdtemp(join(tmpdir(), 'sedge-e2e-'));
const paths = sedgePaths(home);
const env = { ...process.env, SEDGE_HOME: home, SEDGE_NO_UPDATE: '1' };
const CHAT = 4242;
// The daemon and `sedge install` run from source, or from a compiled binary when SEDGE_BIN is set.
const cli = process.env.SEDGE_BIN
    ? [resolve(process.env.SEDGE_BIN)]
    : ['bun', join(resolve(import.meta.dir, '../../..'), 'apps/cli/src/main.ts')];

// ── A fake Telegram Bot API ────────────────────────────────────────────────────────────────────
type Sent = {
    chat_id: number;
    text: string;
    reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> };
};
const updates: Array<Record<string, unknown>> = [];
const sent: Array<Sent> = [];
let nextUpdate = 1;
const user = { id: CHAT, first_name: 'Test', username: 'tester' };
const pushMessage = (text: string) =>
    updates.push({
        update_id: nextUpdate++,
        message: {
            message_id: nextUpdate,
            date: Date.now() / 1000,
            chat: { id: CHAT, type: 'private' },
            from: user,
            text,
        },
    });
const pushButton = (data: string) =>
    updates.push({
        update_id: nextUpdate++,
        callback_query: {
            id: `cb${nextUpdate}`,
            from: user,
            data,
            message: { message_id: 1, chat: { id: CHAT, type: 'private' }, text: 'x' },
        },
    });

const server = Bun.serve({
    port: 0,
    async fetch(request) {
        const method = new URL(request.url).pathname.split('/').pop();
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const ok = (result: unknown) => Response.json({ ok: true, result });
        switch (method) {
            case 'getMe':
                return ok({ id: 1, username: 'sedge_e2e_bot' });
            case 'getUpdates': {
                const offset = Number(body.offset ?? 0);
                for (let i = 0; i < 20; i++) {
                    const ready = updates.filter((u) => (u.update_id as number) >= offset);
                    if (ready.length) return ok(ready);
                    await Bun.sleep(100);
                }
                return ok([]);
            }
            case 'sendMessage':
                sent.push(body as unknown as Sent);
                return ok({ message_id: sent.length });
            default:
                return ok(true);
        }
    },
});

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────
let failed = false;
const step = (name: string) => console.log(`\n▸ ${name}`);
const pass = (detail: string) => console.log(`  ✓ ${detail}`);
const fail = (detail: string) => {
    console.log(`  ✗ ${detail}`);
    failed = true;
    throw new Error(detail);
};
const waitFor = async <A>(what: string, check: () => A | undefined, seconds = 120): Promise<A> => {
    for (let i = 0; i < seconds * 4; i++) {
        const value = check();
        if (value !== undefined) return value;
        await Bun.sleep(250);
    }
    return fail(`timed out waiting for ${what}`);
};
const sentTo = (since: number, match: (m: Sent) => boolean) =>
    sent.slice(since).find((m) => m.chat_id === CHAT && match(m));
const sedge = (...args: Array<string>) =>
    Bun.spawn(['bun', join(root, 'apps/cli/src/main.ts'), ...args], {
        env,
        stdout: 'pipe',
        stderr: 'pipe',
    });
const withDaemon = <A, E>(use: (d: Daemon['Service']) => Effect.Effect<A, E>) =>
    Effect.runPromise(
        Effect.gen(function* () {
            return yield* use(yield* Daemon);
        }).pipe(Effect.provide(DaemonLive(paths, { autostart: false }))),
    );

// ── The walk ───────────────────────────────────────────────────────────────────────────────────
let daemon: ReturnType<typeof Bun.spawn> | undefined;
try {
    step('start the daemon');
    daemon = Bun.spawn([...cli, 'start', '--foreground'], {
        env,
        stdout: Bun.file(join(home, 'daemon.out')),
        stderr: Bun.file(join(home, 'daemon.out')),
    });
    if (!(await Effect.runPromise(waitUntil(paths, true)))) fail('daemon did not listen');
    pass(`listening (home ${home})`);

    step('sedge install the Telegram source package');
    // From the package folder: sedge packs it the way it would be published, then installs it.
    const install = sedge('install', join(root, 'packages/telegram'));
    const installed = (await new Response(install.stdout).text()).trim();
    if ((await install.exited) !== 0)
        fail(`install failed: ${await new Response(install.stderr).text()}`);
    if (!installed.includes('telegram')) fail(`no telegram type after install: ${installed}`);
    pass(installed);

    step('add the source; the token goes to .env, not the config');
    const added = await withDaemon(({ client }) =>
        client.AddSource({
            name: 'telegram',
            type: 'telegram',
            description: 'my Telegram',
            options: { apiBase: server.url.origin },
            secrets: { token: 'E2E:TOKEN' },
        }),
    );
    const config = await readFile(paths.config, 'utf8');
    const secrets = await readFile(paths.env, 'utf8');
    if (config.includes('E2E:TOKEN')) fail('the token is in config.json');
    if (!secrets.includes('E2E:TOKEN')) fail('the token is not in .env');
    if (((await stat(paths.env)).mode & 0o077) !== 0) fail('.env is readable by others');
    pass(`config names \${…}, .env holds the token (0600); tells: ${added.tell}`);

    step('pair: the bot sends a code, sedge asks for it');
    const questions: Array<{ id: string; title: string }> = [];
    const watcher = Effect.runFork(
        Effect.gen(function* () {
            const d = yield* Daemon;
            yield* d.client
                .Questions()
                .pipe(Stream.runForEach((q) => Effect.sync(() => questions.push(q))));
        }).pipe(Effect.provide(DaemonLive(paths, { autostart: false }))),
    );
    let mark = sent.length;
    pushMessage('hello');
    const codeMessage = await waitFor(
        'the pairing code',
        () => sentTo(mark, (m) => /\d{6}/.test(m.text)),
        20,
    );
    const code = /(\d{6})/.exec(codeMessage.text)![1]!;
    const question = await waitFor('the pairing question', () => questions[0], 20);
    pass(`code sent to the chat; asked: ${question.title}`);
    mark = sent.length;
    await withDaemon(({ client }) => client.Answer({ id: question.id, answer: code }));
    await waitFor('the paired message', () => sentTo(mark, (m) => m.text.startsWith('Paired')), 20);
    pass('paired');
    await Effect.runPromise(Fiber.interrupt(watcher));

    step('a message gets an answer in the chat');
    mark = sent.length;
    pushMessage('Reply with exactly the word: pong-telegram');
    const reply = await waitFor('a reply', () =>
        sentTo(mark, (m) => m.text.includes('pong-telegram')),
    );
    pass(`replied: ${reply.text}`);

    step('a shell command asks for approval in the chat, and runs once approved');
    mark = sent.length;
    pushMessage(
        'Run the shell command `echo approved-ok` with your bash tool and send me exactly what it printed.',
    );
    const request = await waitFor('an approval request', () =>
        sentTo(mark, (m) =>
            Boolean(
                m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data.startsWith('approve:'),
            ),
        ),
    );
    pass(`asked: ${request.text.replaceAll('\n', ' ')}`);
    mark = sent.length;
    pushButton(request.reply_markup!.inline_keyboard[0]![0]!.callback_data);
    const output = await waitFor('the command output', () =>
        sentTo(mark, (m) => m.text.includes('approved-ok')),
    );
    pass(`after approval: ${output.text}`);
} catch (error) {
    failed = true;
    if (!(error instanceof Error && error.message.startsWith('timed out'))) console.error(error);
    console.log(`\nDaemon log: ${join(home, 'daemon.out')}`);
} finally {
    await withDaemon(({ client }) => client.Shutdown({ restart: false })).catch(() => undefined);
    await Bun.sleep(500);
    daemon?.kill();
    void server.stop(true);
    if (!failed) await rm(home, { recursive: true, force: true });
}
console.log(failed ? '\nFAILED' : '\nAll steps passed.');
process.exit(failed ? 1 : 0);

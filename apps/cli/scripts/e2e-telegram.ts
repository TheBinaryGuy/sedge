/*
 * End to end, with a fake Telegram: `bun run e2e:telegram` from the repo root.
 *
 * Starts a fake Bot API server and a daemon from source in a throwaway home, then walks the whole
 * path a user takes: install the Telegram package, connect the channel (the token must land in the
 * keychain, not the config), check a stranger gets no answer, pair through the invite link, message
 * the agent and get an answer in the chat (with "typing…" meanwhile), approve a shell command from
 * the chat's buttons, and disconnect (the token leaves the keychain). The agent steps call the model
 * through your logins. Exits non-zero on the first failure.
 *
 * SEDGE_BIN=dist/npm/sedge-<os>-<cpu>/bin/sedge runs the same walk against a compiled binary.
 */
import { sedgePaths } from '@sedge-hq/core';
import { openSecretStore } from '@sedge-hq/daemon';
import { Effect } from 'effect';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const actions: Array<{ chat_id: number; action: string }> = [];
let nextUpdate = 1;
const user = { id: CHAT, first_name: 'Test', username: 'tester' };
const stranger = { id: 666, first_name: 'Stranger', username: 'stranger' };
const pushMessage = (text: string, from = user) =>
    updates.push({
        update_id: nextUpdate++,
        message: {
            message_id: nextUpdate,
            date: Date.now() / 1000,
            chat: { id: from.id, type: 'private' },
            from,
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
            case 'sendChatAction':
                actions.push(body as unknown as { chat_id: number; action: string });
                return ok(true);
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

    step('sedge install the Telegram package');
    // From the package folder: sedge packs it the way it would be published, then installs it.
    const install = sedge('install', join(root, 'packages/telegram'));
    const installed = (await new Response(install.stdout).text()).trim();
    if ((await install.exited) !== 0)
        fail(`install failed: ${await new Response(install.stderr).text()}`);
    if (!installed.includes('telegram (channel)'))
        fail(`no telegram channel after install: ${installed}`);
    pass(installed);

    step('connect the channel; the token goes to the keychain, not the config');
    const { invite } = await withDaemon(({ client }) =>
        client.Connect({
            name: 'telegram',
            kind: 'telegram',
            settings: { api: server.url.origin },
            secrets: { token: 'E2E:TOKEN' },
            instruction: null,
        }),
    );
    const config = await readFile(paths.config, 'utf8');
    if (config.includes('E2E:TOKEN')) fail('the token is in config.json');
    const store = await openSecretStore(paths);
    if ((await store.get('telegram.token')) !== 'E2E:TOKEN')
        fail(`the token is not in the ${store.backend}`);
    const code = /^https:\/\/t\.me\/sedge_e2e_bot\?start=([\w-]{16,})$/.exec(invite ?? '')?.[1];
    if (!code) fail(`unexpected invite link: ${invite}`);
    pass(`token in the ${store.backend}; invite ${invite}`);

    step('a stranger gets no answer, not even with a wrong code');
    let mark = sent.length;
    pushMessage('hello?', stranger);
    pushMessage('/start not-the-code', stranger);
    await Bun.sleep(2500);
    if (sent.slice(mark).length > 0) fail(`answered a stranger: ${sent.slice(mark)[0]?.text}`);
    pass('silence');

    step('opening the invite link pairs the account');
    mark = sent.length;
    pushMessage(`/start ${code}`);
    await waitFor('the paired message', () => sentTo(mark, (m) => m.text.startsWith('Paired')), 20);
    pass('paired');

    step('the invite works once');
    mark = sent.length;
    pushMessage(`/start ${code}`, stranger);
    await Bun.sleep(2500);
    if (sent.slice(mark).length > 0) fail('the used code paired a second account');
    pass('the second use was ignored');

    step('a message gets an answer in the chat');
    mark = sent.length;
    const typed = actions.length;
    pushMessage('Reply with exactly the word: pong-telegram');
    const reply = await waitFor('a reply', () =>
        sentTo(mark, (m) => m.text.includes('pong-telegram')),
    );
    if (!actions.slice(typed).some((a) => a.chat_id === CHAT && a.action === 'typing'))
        fail('no typing indicator while it worked');
    pass(`replied: ${reply.text} (typing… shown meanwhile)`);

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

    step('disconnect; the token leaves the keychain');
    await withDaemon(({ client }) => client.Disconnect({ name: 'telegram' }));
    if ((await store.get('telegram.token')) !== undefined) fail('the token is still stored');
    pass('gone');
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

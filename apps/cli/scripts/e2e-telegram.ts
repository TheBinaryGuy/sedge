/*
 * End to end, with a fake Telegram: `bun run e2e:telegram` from the repo root.
 *
 * Starts a fake Bot API server and a daemon from source in a throwaway home, then walks the whole
 * path a user takes: install the Telegram package, connect the channel (the token must land in the
 * keychain, not the config), check a stranger gets no answer, pair through the invite link, message
 * the agent and get an answer in the chat (with "typing…" meanwhile), approve a shell command from
 * the chat's buttons, have main start a subagent and get its answer back, filter, batch,
 * condition, throttle and triage webhook signals' events, and disconnect (the token leaves the keychain). The agent steps call the model
 * through your logins. Exits non-zero on the first failure.
 *
 * SEDGE_BIN=dist/npm/sedge-<os>-<cpu>/bin/sedge runs the same walk against a compiled binary.
 */
import { sedgePaths } from '@sedge-hq/core';
import { openSecretStore } from '@sedge-hq/daemon';
import { Effect, Stream } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
/** Like waitFor, for a check that has to ask the daemon. */
const poll = async <A>(what: string, check: () => Promise<A | undefined>, seconds = 120) => {
    for (let i = 0; i < seconds * 4; i++) {
        const value = await check();
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
    // With the sandbox on where this machine has one, so every step below runs inside it.
    const sandboxed =
        process.platform === 'darwin' ||
        (process.platform === 'linux' && Bun.which('bwrap') !== null);
    if (sandboxed) {
        await mkdir(home, { recursive: true });
        await writeFile(paths.config, JSON.stringify({ sandbox: { enabled: true } }));
    }
    daemon = Bun.spawn([...cli, 'start', '--foreground'], {
        env,
        stdout: Bun.file(join(home, 'daemon.out')),
        stderr: Bun.file(join(home, 'daemon.out')),
    });
    if (!(await Effect.runPromise(waitUntil(paths, true)))) fail('daemon did not listen');
    pass(`listening (home ${home})${sandboxed ? ', sandbox on' : ''}`);

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

    step('an agent of its own answers a task, and main can tell it something');
    const agent = await withDaemon(({ client }) =>
        client.SaveAgent({
            name: 'helper',
            purpose: 'Helps with small tasks. Answer briefly.',
            connections: null,
        }),
    );
    if (!agent.memory.endsWith('/memory/agents/helper'))
        fail(`unexpected memory folder ${agent.memory}`);
    const answer = await withDaemon(({ client }) =>
        client
            .Prompt({ text: 'Reply with exactly the word: helper-ok', cwd: home, agent: 'helper' })
            .pipe(
                Stream.runFold(
                    () => '',
                    (last, event) => (event._tag === 'Finished' ? event.text : last),
                ),
            ),
    );
    if (!answer.includes('helper-ok')) fail(`the agent answered: ${answer}`);
    await withDaemon(({ client }) =>
        client
            .Prompt({
                text: 'Use your tell tool to send the agent "helper" the message "ping from main", then end your turn.',
                cwd: home,
                agent: 'main',
            })
            .pipe(Stream.runDrain),
    );
    const inbox = await withDaemon(({ client }) => client.Inbox({ agent: 'helper', limit: 10 }));
    if (
        !inbox.some(
            (item) => item.source === 'agent:main' && item.prompt.includes('ping from main'),
        )
    ) {
        fail(`no message from main in helper's inbox: ${inbox.map((i) => i.source).join(', ')}`);
    }
    pass(`helper answered "${answer}", and main's tell reached its inbox`);

    step('main starts a subagent, and its answer comes back to main');
    await withDaemon(({ client }) =>
        client
            .Prompt({
                text: 'Use your subagent tool once, with the task "Reply with exactly the word: sub-ok". Then end your turn.',
                cwd: home,
                agent: 'main',
            })
            .pipe(Stream.runDrain),
    );
    const subReport = await poll('the subagent’s answer in main’s inbox', async () => {
        const items = await withDaemon(({ client }) => client.Inbox({ agent: 'main', limit: 20 }));
        return items.find(
            (item) => item.source.startsWith('subagent:') && item.prompt.includes('sub-ok'),
        );
    });
    pass(`main got: ${subReport.prompt.replaceAll('\n', ' ')}`);

    step('a webhook signal: events that don’t match are dropped, the rest arrive in one run');
    const local = sedge('install', join(root, 'packages/local'));
    const localInstalled = (await new Response(local.stdout).text()).trim();
    if ((await local.exited) !== 0)
        fail(`install failed: ${await new Response(local.stderr).text()}`);
    if (!localInstalled.includes('webhook (signal)'))
        fail(`no webhook signal after install: ${localInstalled}`);
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port!;
    void probe.stop(true);
    await withDaemon(({ client }) =>
        client.Connect({
            name: 'hook',
            kind: 'webhook',
            settings: { port },
            secrets: { token: 'hook-secret' },
            instruction: 'Nothing to do: end your turn without sending anything.',
            match: 'deploy',
            batch: '3s',
        }),
    );
    const post = (body: string) =>
        fetch(`http://127.0.0.1:${port}/`, {
            method: 'POST',
            headers: { authorization: 'Bearer hook-secret' },
            body,
        }).then(
            (response) => response.status,
            () => 0,
        );
    await poll('the webhook to listen', async () =>
        (await post('deploy api')) === 202 ? true : undefined,
    );
    await post('just noise');
    await post('deploy web');
    const hooked = await poll('both deploys handled', async () => {
        const items = await withDaemon(({ client }) => client.Inbox({ agent: 'main', limit: 50 }));
        const mine = items.filter((item) => item.source === 'hook');
        return mine.length >= 2 && mine.every((item) => item.finishedAt !== null)
            ? mine
            : undefined;
    });
    if (hooked.some((item) => item.prompt.includes('just noise')))
        fail('an event that did not match got through');
    if (hooked.length !== 2) fail(`expected 2 events, got ${hooked.length}`);
    if (hooked[0]!.finishedAt !== hooked[1]!.finishedAt)
        fail('the batched events were handled in separate runs');
    const held = hooked[0]!.finishedAt! - Math.min(...hooked.map((item) => item.createdAt));
    if (held < 3000) fail(`the batch was handed over after ${held} ms, before its 3s window`);
    pass(`2 of 3 posts got through, handled together after ${held} ms`);
    await withDaemon(({ client }) => client.Disconnect({ name: 'hook' }));

    step('a condition and a throttle: only readings over the limit, and only the first');
    const alarmPort = (() => {
        const p = Bun.serve({ port: 0, fetch: () => new Response() });
        const n = p.port!;
        void p.stop(true);
        return n;
    })();
    await withDaemon(({ client }) =>
        client.Connect({
            name: 'alarm',
            kind: 'webhook',
            settings: { port: alarmPort },
            secrets: { token: 'alarm-secret' },
            instruction: 'Nothing to do: end your turn without sending anything.',
            when: 'body.temperature > 30',
            throttle: '1h',
        }),
    );
    const reading = (temperature: number) =>
        fetch(`http://127.0.0.1:${alarmPort}/`, {
            method: 'POST',
            headers: { authorization: 'Bearer alarm-secret', 'content-type': 'application/json' },
            body: JSON.stringify({ temperature }),
        }).then(
            (response) => response.status,
            () => 0,
        );
    await poll('the alarm webhook to listen', async () =>
        (await reading(21)) === 202 ? true : undefined,
    );
    await reading(34);
    await reading(36);
    await Bun.sleep(1500);
    const alarms = (
        await withDaemon(({ client }) => client.Inbox({ agent: 'main', limit: 50 }))
    ).filter((item) => item.source === 'alarm');
    if (alarms.length !== 1 || !alarms[0]!.prompt.includes('"temperature": 34'))
        fail(`expected only the 34° reading, got: ${alarms.map((a) => a.prompt).join(' | ')}`);
    pass('21° was below the limit and 36° came inside the throttle window: one event');
    await withDaemon(({ client }) => client.Disconnect({ name: 'alarm' }));

    step('triage: a cheap model skips what the instruction says needs nothing');
    const deployPort = (() => {
        const p = Bun.serve({ port: 0, fetch: () => new Response() });
        const n = p.port!;
        void p.stop(true);
        return n;
    })();
    await withDaemon(({ client }) =>
        client.Connect({
            name: 'deploys',
            kind: 'webhook',
            settings: { port: deployPort },
            secrets: { token: 'deploy-secret' },
            instruction:
                'Only failed deploys matter. For a failed one, end your turn without sending anything.',
            triage: true,
        }),
    );
    const deploy = (status: string) =>
        fetch(`http://127.0.0.1:${deployPort}/`, {
            method: 'POST',
            headers: { authorization: 'Bearer deploy-secret', 'content-type': 'application/json' },
            body: JSON.stringify({ service: 'api', status }),
        }).then(
            (response) => response.status,
            () => 0,
        );
    await poll('the deploy webhook to listen', async () =>
        (await deploy('succeeded')) === 202 ? true : undefined,
    );
    const finished = (n: number) =>
        poll(`${n} deploy event(s) handled`, async () => {
            const items = (
                await withDaemon(({ client }) => client.Inbox({ agent: 'main', limit: 50 }))
            ).filter((item) => item.source === 'deploys');
            return items.length >= n && items.every((item) => item.finishedAt !== null)
                ? items
                : undefined;
        });
    const [succeeded] = await finished(1);
    if (!succeeded?.result?.startsWith('Skipped by triage'))
        fail(`the successful deploy woke the agent: ${succeeded?.result}`);
    pass(succeeded?.result ?? '');
    await deploy('failed');
    const [failedDeploy] = await finished(2);
    if (failedDeploy?.result?.startsWith('Skipped by triage'))
        fail(`triage skipped the failed deploy: ${failedDeploy.result}`);
    pass('the failed deploy woke the agent');
    await withDaemon(({ client }) => client.Disconnect({ name: 'deploys' }));

    step('uninstall waits until nothing of the package is connected');
    const early = sedge('uninstall', 'telegram');
    const refusal = await new Response(early.stderr).text();
    if ((await early.exited) === 0) fail('uninstalled a package that is still connected');
    if (!refusal.includes('Disconnect')) fail(`unexpected refusal: ${refusal}`);
    pass('refused while connected');

    step('disconnect; the token leaves the keychain');
    await withDaemon(({ client }) => client.Disconnect({ name: 'telegram' }));
    if ((await store.get('telegram.token')) !== undefined) fail('the token is still stored');
    pass('gone');

    step('sedge uninstall the Telegram package');
    const uninstall = sedge('uninstall', 'telegram');
    const uninstalled = (await new Response(uninstall.stdout).text()).trim();
    if ((await uninstall.exited) !== 0)
        fail(`uninstall failed: ${await new Response(uninstall.stderr).text()}`);
    const left = await withDaemon(({ client }) => client.Kinds());
    if (left.some((k) => k.name === 'telegram')) fail('the telegram kind is still there');
    pass(uninstalled);
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

import type { ServerWebSocket } from 'bun';
import { expect, it } from 'vitest';
import slack from './slack';

const until = async (check: () => boolean, ms = 3000) => {
    for (let waited = 0; !check(); waited += 10) {
        if (waited > ms) throw new Error('timed out');
        await Bun.sleep(10);
    }
};

it('pairs through a code, takes DMs and picks, and replies with buttons, over Socket Mode', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const acks: Array<string> = [];
    let socket: ServerWebSocket<unknown> | undefined;
    const server = Bun.serve({
        port: 0,
        fetch: async (request, srv) => {
            const path = new URL(request.url).pathname;
            if (path === '/ws')
                return srv.upgrade(request) ? undefined : new Response('no', { status: 400 });
            const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
            const ok = (more: Record<string, unknown> = {}) => Response.json({ ok: true, ...more });
            if (path.endsWith('/auth.test'))
                return ok({ user_id: 'UBOT', team_id: 'T1', bot_id: 'B1', team: 'Acme' });
            if (path.endsWith('/bots.info')) return ok({ bot: { app_id: 'A1' } });
            if (path.endsWith('/apps.connections.open'))
                return ok({ url: `ws://localhost:${srv.port}/ws` });
            if (path.endsWith('/chat.postMessage')) {
                posted.push(body);
                return ok({ ts: '1.1' });
            }
            return ok();
        },
        websocket: {
            open: (ws) => {
                socket = ws;
                ws.send(JSON.stringify({ type: 'hello' }));
            },
            message: (_ws, data) =>
                void acks.push((JSON.parse(String(data)) as { envelope_id: string }).envelope_id),
        },
    });
    const dm = (id: string, user: string, text: string) =>
        socket!.send(
            JSON.stringify({
                envelope_id: id,
                type: 'events_api',
                payload: {
                    event: {
                        type: 'message',
                        channel_type: 'im',
                        channel: 'D1',
                        user,
                        text,
                        ts: id,
                    },
                },
            }),
        );

    const received: Array<unknown> = [];
    const running = slack.start(
        { appToken: 'xapp', botToken: 'xoxb', api: `${server.url.origin}/api` },
        {
            status: () => {},
            memoGet: async () => undefined,
            memoSet: async () => {},
            happened: async () => {},
            received: async (event) => void received.push(event),
            claim: async (code) => code === 'right-code',
        },
    );
    expect(await running.invite!('right-code')).toBe(
        'In Slack, send the sedge bot this message: pair right-code (open its DM: https://slack.com/app_redirect?app=A1&team=T1)',
    );
    await until(() => socket !== undefined);

    // Strangers, and wrong codes, get nothing.
    dm('e1', 'U2', 'hello?');
    dm('e2', 'U2', 'pair wrong-code');
    dm('e3', 'U1', 'pair right-code');
    await until(() => posted.length === 1);
    expect(posted[0]).toMatchObject({
        channel: 'D1',
        text: "Paired. I'm sedge; write to me here any time.",
    });

    dm('e4', 'U1', 'what is **on** today?');
    await until(() => received.length === 1);
    expect(received[0]).toEqual({
        _tag: 'Message',
        from: 'D1',
        text: 'what is **on** today?',
        key: 'e4',
    });

    await running.deliver!({
        text: 'May I **merge** it?',
        choices: [{ label: 'Yes', value: 'yes' }],
    });
    expect(posted[1]).toMatchObject({
        channel: 'D1',
        text: 'May I *merge* it?',
        blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: 'May I *merge* it?' } },
            {
                type: 'actions',
                elements: [
                    { type: 'button', text: { type: 'plain_text', text: 'Yes' }, value: 'yes' },
                ],
            },
        ],
    });

    socket!.send(
        JSON.stringify({
            envelope_id: 'e5',
            type: 'interactive',
            payload: {
                type: 'block_actions',
                user: { id: 'U1' },
                channel: { id: 'D1' },
                actions: [{ value: 'yes', text: { text: 'Yes' } }],
                message: { ts: '1.1', text: 'May I merge it?' },
            },
        }),
    );
    await until(() => received.length === 2);
    expect(received[1]).toEqual({ _tag: 'Picked', from: 'D1', value: 'yes', key: '1.1:yes' });
    await until(() => acks.length === 5);
    expect(acks).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);

    await running.stop();
    void server.stop(true);
});

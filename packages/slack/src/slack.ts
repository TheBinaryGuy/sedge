import { defineChannel, field, type Reply, secret } from '@sedge-hq/kit';
import { DEFAULT_API, makeSlack } from './api';
import { toMrkdwn } from './mrkdwn';

/** Slack's limit for one block of text. */
const SECTION = 3000;

const blocks = (reply: Reply) => {
    const text = toMrkdwn(reply.text);
    const sections = [];
    for (let i = 0; i < text.length; i += SECTION) {
        sections.push({
            type: 'section',
            text: { type: 'mrkdwn', text: text.slice(i, i + SECTION) },
        });
    }
    if (reply.choices?.length) {
        sections.push({
            type: 'actions',
            elements: reply.choices.slice(0, 25).map((choice, i) => ({
                type: 'button',
                action_id: `sedge-${i}`,
                text: { type: 'plain_text', text: choice.label.slice(0, 75) },
                value: choice.value.slice(0, 2000),
            })),
        });
    }
    return { text, blocks: sections };
};

interface Envelope {
    readonly envelope_id?: string;
    readonly type: string;
    readonly payload?: {
        readonly event?: {
            readonly type?: string;
            readonly channel_type?: string;
            readonly channel?: string;
            readonly user?: string;
            readonly text?: string;
            readonly ts?: string;
            readonly bot_id?: string;
            readonly subtype?: string;
        };
        readonly type?: string;
        readonly user?: { readonly id?: string };
        readonly channel?: { readonly id?: string };
        readonly actions?: ReadonlyArray<{
            readonly value?: string;
            readonly text?: { readonly text?: string };
        }>;
        readonly message?: { readonly ts?: string; readonly text?: string };
    };
}

/**
 * Slack as a sedge channel: message the bot in a DM, and sedge answers there. It connects with
 * Socket Mode, so nothing has to be reachable from the internet.
 *
 * Make an app at api.slack.com/apps: turn on Socket Mode (that gives the app-level token, with
 * `connections:write`), subscribe to the `message.im` bot event, turn on Interactivity, and add
 * the bot scopes `chat:write`, `im:history` and `files:write`. Install it, and give sedge both
 * tokens.
 *
 * It only talks to people paired through an invite: they send the bot `pair <code>`, with a code
 * shown only on your screen. Everyone else gets no answer.
 */
export default defineChannel({
    name: 'slack',
    summary: 'your Slack: message sedge in a DM, and it answers there',
    settings: {
        appToken: secret(
            'The app-level token (xapp-…), from Basic Information → App-Level Tokens, with connections:write.',
        ),
        botToken: secret('The bot token (xoxb-…), from OAuth & Permissions.'),
        api: field.optional(field.text('The Slack API address. Default: slack.com/api.')),
    },
    connect: async ({ appToken, botToken, api }, kit) => {
        const slack = makeSlack(api ?? DEFAULT_API, kit.signal);
        const me = await slack.call<{
            user_id: string;
            team_id: string;
            bot_id: string;
            team?: string;
        }>('auth.test', botToken);
        const bot = await slack
            .call<{ bot?: { app_id?: string } }>('bots.info', botToken, { bot: me.bot_id })
            .catch(() => ({ bot: undefined }));
        const appId = bot.bot?.app_id;

        const paired = new Set<string>(
            JSON.parse((await kit.memo.get('paired')) ?? '[]') as Array<string>,
        );
        let home = (await kit.memo.get('home')) ?? undefined;
        const showStatus = () =>
            kit.status(
                paired.size > 0
                    ? `${me.team ?? me.team_id} · paired`
                    : `${me.team ?? me.team_id} · send the bot the pairing code`,
            );
        showStatus();

        const post = (channel: string, reply: Reply) =>
            slack.call('chat.postMessage', botToken, {
                channel,
                unfurl_links: false,
                ...blocks(reply),
            });

        const handle = async (envelope: Envelope) => {
            const event = envelope.payload?.event;
            if (envelope.type === 'events_api' && event?.type === 'message') {
                // Direct messages from people only: not the bot's own, not edits, not channels.
                if (
                    event.channel_type !== 'im' ||
                    event.bot_id ||
                    event.subtype ||
                    !event.user ||
                    !event.channel
                )
                    return;
                const pair = /^\s*pair\s+(\S+)\s*$/i.exec(event.text ?? '');
                if (pair && !paired.has(event.user)) {
                    if (await kit.claim(pair[1]!, event.user)) {
                        paired.add(event.user);
                        home = event.channel;
                        await kit.memo.set('paired', JSON.stringify([...paired]));
                        await kit.memo.set('home', home);
                        await post(event.channel, {
                            text: "Paired. I'm sedge; write to me here any time.",
                        });
                        showStatus();
                    }
                    return;
                }
                if (!paired.has(event.user)) return;
                home = event.channel;
                await kit.memo.set('home', home);
                if (!event.text) return;
                return kit.receive({
                    type: 'message',
                    from: event.channel,
                    text: event.text,
                    key: event.ts ?? '',
                });
            }
            const payload = envelope.payload;
            if (envelope.type === 'interactive' && payload?.type === 'block_actions') {
                const user = payload.user?.id;
                const channel = payload.channel?.id;
                const action = payload.actions?.[0];
                if (!user || !channel || !action?.value || !paired.has(user)) return;
                // The buttons go; what was picked stays in the message.
                if (payload.message?.ts) {
                    await slack
                        .call('chat.update', botToken, {
                            channel,
                            ts: payload.message.ts,
                            text: `${payload.message.text ?? ''}\n\n✓ ${action.text?.text ?? action.value}`,
                            blocks: [],
                        })
                        .catch(() => undefined);
                }
                return kit.receive({
                    type: 'picked',
                    from: channel,
                    value: action.value,
                    key: `${payload.message?.ts}:${action.value}`,
                });
            }
        };

        const chatFor = (to?: string) => {
            const channel = to ?? home;
            if (!channel || paired.size === 0)
                throw new Error('Slack is not paired yet: send the bot the pairing code first.');
            return channel;
        };

        return {
            // Socket Mode: a WebSocket Slack hands events to. Each is acknowledged at once; when Slack
            // says it's moving the connection, this returns an error and the kit connects again.
            listen: async () => {
                const { url } = await slack.call<{ url: string }>(
                    'apps.connections.open',
                    appToken,
                );
                await new Promise<void>((resolve, reject) => {
                    const socket = new WebSocket(url);
                    const stop = () => {
                        socket.close();
                        resolve();
                    };
                    kit.signal.addEventListener('abort', stop, { once: true });
                    socket.addEventListener('message', (message) => {
                        const envelope = JSON.parse(String(message.data)) as Envelope;
                        if (envelope.envelope_id)
                            socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
                        if (envelope.type === 'disconnect') return socket.close();
                        void handle(envelope).catch((error: unknown) =>
                            kit.status(
                                `couldn't handle a Slack event: ${error instanceof Error ? error.message : String(error)}`,
                            ),
                        );
                    });
                    socket.addEventListener('close', () => {
                        kit.signal.removeEventListener('abort', stop);
                        if (!kit.signal.aborted) reject(new Error('Slack closed the connection'));
                    });
                    socket.addEventListener('error', () =>
                        reject(new Error('Slack connection failed')),
                    );
                });
            },
            invite: (code) =>
                `In Slack, send the sedge bot this message: pair ${code}${appId ? ` (open its DM: https://slack.com/app_redirect?app=${appId}&team=${me.team_id})` : ''}`,
            deliver: async (reply, to) => {
                const channel = chatFor(to);
                await post(channel, reply);
                for (const file of reply.files ?? [])
                    await slack.upload(botToken, channel, file.path, file.caption);
            },
        };
    },
});

import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import type { AgentInfo, InboxEntry, OutboxEntry, TimerInfo } from '@sedge-hq/protocol';
import type { Effect } from 'effect';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Daemon } from './client';

type WithDaemon = <A, E>(use: (daemon: Daemon['Service']) => Effect.Effect<A, E>) => Promise<A>;

export const TABS = ['agents', 'inbox', 'outbox', 'timers', 'memory'] as const;
export type Tab = (typeof TABS)[number];

const when = (ms: number) =>
    new Date(ms).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

const oneLine = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

/** `agent:ci` → `ci`; `main`, `dream` and `cli:<dir>` stay as they are. */
const owner = (thread: string) => (thread.startsWith('agent:') ? thread.slice(6) : thread);

const filesUnder = async (dir: string, root = dir): Promise<Array<string>> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(
        entries.map((entry) =>
            entry.isDirectory()
                ? entry.name === 'agents' && dir === root
                    ? Promise.resolve([])
                    : filesUnder(join(dir, entry.name), root)
                : Promise.resolve([relative(root, join(dir, entry.name))]),
        ),
    );
    return nested.flat().sort();
};

/** The lines of one tab, for everyone or for one agent. */
const load = async (
    tab: Tab,
    agent: string | undefined,
    withDaemon: WithDaemon,
    theme: Theme,
): Promise<Array<string>> => {
    const muted = (text: string) => theme.fg('muted', text);
    const dim = (text: string) => theme.fg('dim', text);
    const status = (text: string) =>
        text === 'failed'
            ? theme.fg('error', text)
            : text === 'pending' || text === 'running'
              ? theme.fg('warning', text)
              : theme.fg('success', text);
    const filter = agent ?? null;

    if (tab === 'agents') {
        const agents: ReadonlyArray<AgentInfo> = await withDaemon(({ client }) => client.Agents());
        return agents
            .filter((a) => !agent || a.name === agent)
            .flatMap((a) => [
                `${theme.bold(a.name)}  ${a.running ? theme.fg('warning', 'working') : dim('idle')}${a.pending ? `  ${muted(`${a.pending} queued`)}` : ''}`,
                `  ${a.purpose}`,
                `  ${dim('handles:')} ${a.connections.join(', ') || dim('nothing yet')}`,
                `  ${dim('memory:')} ${a.memory}`,
                '',
            ]);
    }
    if (tab === 'inbox') {
        const items: ReadonlyArray<InboxEntry> = await withDaemon(({ client }) =>
            client.Inbox({ agent: filter, limit: 100 }),
        );
        return items.length === 0
            ? [dim('No events yet.')]
            : items.flatMap((item) => [
                  `${dim(when(item.createdAt))}  ${theme.bold(owner(item.thread))}  ${muted(`from ${item.source}`)}  ${status(item.status)}`,
                  `  ${oneLine(item.prompt).slice(0, 400)}`,
                  ...(item.error
                      ? [`  ${theme.fg('error', oneLine(item.error).slice(0, 300))}`]
                      : []),
              ]);
    }
    if (tab === 'outbox') {
        const messages: ReadonlyArray<OutboxEntry> = await withDaemon(({ client }) =>
            client.Outbox({ agent: filter, limit: 100 }),
        );
        return messages.length === 0
            ? [dim('Nothing sent yet.')]
            : messages.flatMap((message) => [
                  `${dim(when(message.createdAt))}  ${theme.bold(owner(message.thread))}  ${message.kind === 'approval' ? muted('approval') : ''}  ${status(message.status)}${message.attempts > 1 ? dim(` · ${message.attempts} attempts`) : ''}`,
                  `  ${oneLine(message.text).slice(0, 400)}`,
                  ...(message.error
                      ? [`  ${theme.fg('error', oneLine(message.error).slice(0, 300))}`]
                      : []),
              ]);
    }
    if (tab === 'timers') {
        const timers: ReadonlyArray<TimerInfo> = await withDaemon(({ client }) =>
            client.Timers({ agent: filter }),
        );
        return timers.length === 0
            ? [dim('No timers.')]
            : timers.flatMap((timer) => [
                  `${theme.bold(owner(timer.thread))}  ${timer.kind === 'schedule' ? `every ${timer.cron}` : 'once'}  ${dim(`next ${when(timer.nextRunAt)}`)}${timer.name ? `  ${muted(timer.name)}` : ''}  ${dim(timer.id)}`,
                  `  ${oneLine(timer.prompt).slice(0, 300)}`,
              ]);
    }
    // memory: each agent's index and the files beside it
    const agents: ReadonlyArray<AgentInfo> = await withDaemon(({ client }) => client.Agents());
    const lines: Array<string> = [];
    for (const a of agents.filter((x) => !agent || x.name === agent)) {
        const index = await readFile(join(a.memory, 'MEMORY.md'), 'utf8').catch(() => '');
        const files = (await filesUnder(a.memory)).filter((file) => file !== 'MEMORY.md');
        lines.push(`${theme.bold(a.name)}  ${dim(a.memory)}`);
        lines.push(
            ...(index.trim()
                ? index
                      .trim()
                      .split('\n')
                      .map((line) => `  ${line}`)
                : [`  ${dim('(empty)')}`]),
        );
        if (files.length > 0) lines.push(`  ${dim(`files: ${files.join(', ')}`)}`);
        lines.push('');
    }
    lines.push(
        dim(
            'To change what an agent remembers, ask here ("make ci forget the old staging URL"), or edit the files.',
        ),
    );
    return lines;
};

/**
 * `/sedge`: what the daemon is doing, in one place. Tabs for agents, the inbox, the outbox, timers
 * and memory; ← → switch, ↑ ↓ scroll, r refreshes, esc closes. With an agent name, only its share.
 */
export const openDashboard = (
    ctx: ExtensionContext,
    withDaemon: WithDaemon,
    start: Tab = 'agents',
    agent?: string,
) =>
    ctx.ui.custom<void>((tui, theme, _keys, done) => {
        let tab: Tab = start;
        let lines: Array<string> = [theme.fg('dim', 'Loading…')];
        let scroll = 0;
        const height = () => Math.max(8, (process.stdout.rows ?? 30) - 8);

        const refresh = () => {
            lines = [theme.fg('dim', 'Loading…')];
            tui.requestRender();
            load(tab, agent, withDaemon, theme).then(
                (loaded) => {
                    lines = loaded;
                    tui.requestRender();
                },
                (error: unknown) => {
                    lines = [theme.fg('error', `The daemon didn't answer: ${String(error)}`)];
                    tui.requestRender();
                },
            );
        };
        refresh();

        return {
            render: (width: number) => {
                const tabs = TABS.map((name) =>
                    name === tab ? theme.bold(theme.fg('accent', name)) : theme.fg('muted', name),
                ).join(theme.fg('dim', '  ·  '));
                const visible = lines.slice(scroll, scroll + height());
                return [
                    '',
                    `${theme.bold('sedge')}${agent ? theme.fg('muted', ` · ${agent}`) : ''}   ${tabs}`,
                    '',
                    ...visible,
                    ...(lines.length > height()
                        ? [
                              theme.fg(
                                  'dim',
                                  `${scroll + 1}–${Math.min(scroll + height(), lines.length)} of ${lines.length}`,
                              ),
                          ]
                        : []),
                    '',
                    theme.fg('dim', '← → tabs · ↑ ↓ scroll · r refresh · esc close'),
                ].map((line) => truncateToWidth(line, width));
            },
            handleInput: (data: string) => {
                if (matchesKey(data, 'escape') || data === 'q') return done(undefined);
                if (matchesKey(data, 'right') || matchesKey(data, 'left')) {
                    const step = matchesKey(data, 'right') ? 1 : TABS.length - 1;
                    tab = TABS[(TABS.indexOf(tab) + step) % TABS.length]!;
                    scroll = 0;
                    return refresh();
                }
                if (data === 'r') return refresh();
                if (matchesKey(data, 'down'))
                    scroll = Math.min(scroll + 1, Math.max(0, lines.length - height()));
                if (matchesKey(data, 'up')) scroll = Math.max(0, scroll - 1);
                if (matchesKey(data, 'pageDown'))
                    scroll = Math.min(scroll + height(), Math.max(0, lines.length - height()));
                if (matchesKey(data, 'pageUp')) scroll = Math.max(0, scroll - height());
                tui.requestRender();
            },
            invalidate: () => {},
        };
    });

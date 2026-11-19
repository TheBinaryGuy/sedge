import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
    type Component,
    matchesKey,
    truncateToWidth,
    wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import { LOGO } from '@sedge-hq/core';
import type { AgentInfo, DaemonStatus } from '@sedge-hq/protocol';
import type { Effect } from 'effect';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type { Daemon } from './client';

type WithDaemon = <A, E>(use: (daemon: Daemon['Service']) => Effect.Effect<A, E>) => Promise<A>;

export const TABS = ['agents', 'inbox', 'outbox', 'timers', 'memory'] as const;
export type Tab = (typeof TABS)[number];

/** Colours: the chat's theme inside pi, sedge's own palette in `sedge dash`. */
export interface Paint {
    readonly accent: (text: string) => string;
    readonly muted: (text: string) => string;
    readonly dim: (text: string) => string;
    readonly bold: (text: string) => string;
    readonly error: (text: string) => string;
    readonly warning: (text: string) => string;
    readonly success: (text: string) => string;
    readonly selected: (text: string) => string;
}

/** One line in the list, and what the detail pane shows when it's selected. */
interface Row {
    readonly line: string;
    readonly detail: ReadonlyArray<string>;
}

const when = (ms: number) =>
    new Date(ms).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
const oneLine = (text: string) => text.replaceAll(/\s+/g, ' ').trim();
/** Paths under your home folder, as `~/…`. */
const tilde = (path: string) =>
    path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
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

const loadRows = async (
    tab: Tab,
    agent: string | undefined,
    agents: ReadonlyArray<AgentInfo>,
    withDaemon: WithDaemon,
    paint: Paint,
): Promise<Array<Row>> => {
    const status = (text: string) =>
        text === 'failed'
            ? paint.error(text)
            : text === 'pending' || text === 'running'
              ? paint.warning(text)
              : paint.success(text);
    const filter = agent ?? null;
    const mine = agents.filter((a) => !agent || a.name === agent);

    if (tab === 'agents') {
        return mine.map((a) => ({
            line: `${paint.bold(a.name.padEnd(12))} ${a.running ? paint.warning('working') : paint.dim('idle   ')}  ${a.pending ? paint.muted(`${a.pending} queued  `) : ''}${paint.dim(oneLine(a.purpose))}`,
            detail: [
                a.purpose,
                '',
                `${paint.dim('handles')}  ${a.connections.join(', ') || 'nothing yet'}`,
                `${paint.dim('memory ')}  ${tilde(a.memory)}`,
            ],
        }));
    }
    if (tab === 'inbox') {
        const items = await withDaemon(({ client }) => client.Inbox({ agent: filter, limit: 200 }));
        return items.map((item) => ({
            line: `${paint.dim(when(item.createdAt))}  ${paint.bold(owner(item.thread).padEnd(10))} ${status(item.status.padEnd(7))} ${paint.muted(item.source.padEnd(10))} ${oneLine(item.prompt)}`,
            detail: [
                `${paint.dim('from')} ${item.source} ${paint.dim('to')} ${owner(item.thread)} ${paint.dim('·')} ${status(item.status)}${item.finishedAt ? paint.dim(` · done ${when(item.finishedAt)}`) : ''}`,
                '',
                item.prompt,
                ...(item.error ? ['', paint.error(item.error)] : []),
            ],
        }));
    }
    if (tab === 'outbox') {
        const messages = await withDaemon(({ client }) =>
            client.Outbox({ agent: filter, limit: 200 }),
        );
        return messages.map((message) => ({
            line: `${paint.dim(when(message.createdAt))}  ${paint.bold(owner(message.thread).padEnd(10))} ${status(message.status.padEnd(7))} ${message.kind === 'approval' ? paint.warning('approval ') : ''}${oneLine(message.text)}`,
            detail: [
                `${paint.dim('from')} ${owner(message.thread)} ${paint.dim('·')} ${status(message.status)}${message.attempts > 1 ? paint.dim(` · ${message.attempts} attempts`) : ''}${message.sentAt ? paint.dim(` · sent ${when(message.sentAt)}`) : ''}`,
                '',
                message.text,
                ...(message.error ? ['', paint.error(message.error)] : []),
            ],
        }));
    }
    if (tab === 'timers') {
        const timers = await withDaemon(({ client }) => client.Timers({ agent: filter }));
        return timers.map((timer) => ({
            line: `${paint.dim(when(timer.nextRunAt))}  ${paint.bold(owner(timer.thread).padEnd(10))} ${paint.muted((timer.kind === 'schedule' ? (timer.cron ?? '') : 'once').padEnd(14))} ${timer.name ? `${timer.name}: ` : ''}${oneLine(timer.prompt)}`,
            detail: [
                `${paint.dim('next')} ${when(timer.nextRunAt)} ${paint.dim('·')} ${timer.kind === 'schedule' ? `every ${timer.cron}` : 'once'} ${paint.dim(`· ${timer.id}`)}`,
                '',
                timer.prompt,
            ],
        }));
    }
    return Promise.all(
        mine.map(async (a) => {
            const index = (
                await readFile(join(a.memory, 'MEMORY.md'), 'utf8').catch(() => '')
            ).trim();
            const files = (await filesUnder(a.memory)).filter((file) => file !== 'MEMORY.md');
            return {
                line: `${paint.bold(a.name.padEnd(12))} ${paint.muted(plural(files.length + (index ? 1 : 0), 'file').padEnd(10))} ${paint.dim(tilde(a.memory))}`,
                detail: [
                    ...(index ? index.split('\n') : [paint.dim('MEMORY.md is empty.')]),
                    ...(files.length ? ['', `${paint.dim('files')}  ${files.join(', ')}`] : []),
                    '',
                    paint.dim('To change what it remembers, ask in sedge, or edit the files.'),
                ],
            };
        }),
    );
};

const EMPTY: Record<Tab, string> = {
    agents: 'No agents.',
    inbox: 'Nothing has arrived yet.',
    outbox: 'Nothing has been sent yet.',
    timers: 'No timers.',
    memory: 'No memory yet.',
};

/**
 * The daemon at a glance: its agents, the inbox, the outbox, timers and memory, filtered to one
 * agent or not, with the selected item in full below. The same view is `/sedge` in the chat and
 * `sedge dash` on its own.
 */
export class DashboardView implements Component {
    private tab: Tab;
    private agent: string | undefined;
    private agents: ReadonlyArray<AgentInfo> = [];
    private status: DaemonStatus | undefined;
    private rows: ReadonlyArray<Row> = [];
    private selected = 0;
    private top = 0;
    private expanded = false;
    private problem: string | undefined;
    private loading = true;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly options: {
            readonly withDaemon: WithDaemon;
            readonly paint: Paint;
            readonly rows: () => number;
            readonly requestRender: () => void;
            readonly close: () => void;
            readonly tab?: Tab;
            readonly agent?: string;
            /** `sedge dash` puts the logo and status on top; `/sedge` already has pi's header. */
            readonly header?: boolean;
        },
    ) {
        this.tab = options.tab ?? 'agents';
        this.agent = options.agent;
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), 2000);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    private async refresh() {
        const { withDaemon, paint } = this.options;
        try {
            const [status, agents] = await Promise.all([
                withDaemon(({ client }) => client.Status()),
                withDaemon(({ client }) => client.Agents()),
            ]);
            this.status = status;
            this.agents = agents;
            this.rows = await loadRows(this.tab, this.agent, agents, withDaemon, paint);
            this.problem = undefined;
        } catch (error) {
            this.problem = `The daemon didn't answer (${error instanceof Error ? error.message : String(error)}). Start it with sedge start.`;
        }
        this.loading = false;
        this.selected = Math.min(this.selected, Math.max(0, this.rows.length - 1));
        this.options.requestRender();
    }

    private show(tab: Tab) {
        this.tab = tab;
        this.selected = 0;
        this.top = 0;
        this.expanded = false;
        this.loading = true;
        void this.refresh();
    }

    handleInput(data: string) {
        if (matchesKey(data, 'escape') || data === 'q') {
            this.stop();
            return this.options.close();
        }
        if (matchesKey(data, 'right') || matchesKey(data, 'tab')) {
            return this.show(TABS[(TABS.indexOf(this.tab) + 1) % TABS.length]!);
        }
        if (matchesKey(data, 'left') || matchesKey(data, 'shift+tab')) {
            return this.show(TABS[(TABS.indexOf(this.tab) + TABS.length - 1) % TABS.length]!);
        }
        const digit = Number(data);
        if (digit >= 1 && digit <= TABS.length) return this.show(TABS[digit - 1]!);
        if (data === 'a') {
            const names = [undefined, ...this.agents.map((a) => a.name)];
            this.agent = names[(names.indexOf(this.agent) + 1) % names.length];
            return this.show(this.tab);
        }
        if (data === 'r') return void this.refresh();
        if (matchesKey(data, 'enter')) this.expanded = !this.expanded;
        const last = Math.max(0, this.rows.length - 1);
        if (matchesKey(data, 'down') || data === 'j')
            this.selected = Math.min(this.selected + 1, last);
        if (matchesKey(data, 'up') || data === 'k') this.selected = Math.max(this.selected - 1, 0);
        if (matchesKey(data, 'pageDown')) this.selected = Math.min(this.selected + 10, last);
        if (matchesKey(data, 'pageUp')) this.selected = Math.max(this.selected - 10, 0);
        if (matchesKey(data, 'home') || data === 'g') this.selected = 0;
        if (matchesKey(data, 'end') || data === 'G') this.selected = last;
        this.options.requestRender();
    }

    render(width: number): Array<string> {
        const { paint } = this.options;
        const inner = Math.max(20, width - 2);
        const pad = (line: string) => truncateToWidth(` ${line}`, width);
        const rule = paint.dim('─'.repeat(inner));
        const out: Array<string> = [];

        if (this.options.header) {
            const s = this.status;
            const info = [
                `${paint.bold('sedge')} ${paint.dim(s ? `v${s.info.version}` : '')}`,
                s
                    ? `${s.running.length ? paint.warning(`working: ${s.running.map(owner).join(', ')}`) : paint.success('idle')}${paint.dim(` · ${s.pending} queued · ${plural(s.timers, 'timer')} · pid ${s.info.pid}`)}`
                    : paint.dim('connecting…'),
                paint.dim(
                    s?.update ? `${s.update} installed, applies on restart` : 'the daemon, live',
                ),
            ];
            out.push(
                '',
                ...LOGO.map((row, i) => pad(`${paint.accent(row.padEnd(6))}  ${info[i] ?? ''}`)),
                '',
            );
        }

        const tabs = TABS.map((name, i) =>
            name === this.tab
                ? paint.selected(` ${i + 1} ${name} `)
                : paint.muted(` ${i + 1} ${name} `),
        ).join(' ');
        out.push(pad(tabs));
        const who = [undefined, ...this.agents.map((a) => a.name)]
            .map((name) => {
                const label = name ?? 'all';
                return name === this.agent ? paint.accent(`[${label}]`) : paint.dim(label);
            })
            .join(paint.dim(' · '));
        out.push(pad(`${paint.dim('agent')}  ${who}`), pad(rule));

        // Room for the list and the detail pane, whatever the terminal's height.
        const height = Math.max(10, this.options.rows() - out.length - 3);
        const detailHeight = this.expanded
            ? Math.floor(height * 0.7)
            : Math.min(8, Math.floor(height * 0.4));
        const listHeight = Math.max(3, height - detailHeight - 1);

        if (this.problem) out.push(pad(paint.error(this.problem)));
        else if (this.loading && this.rows.length === 0) out.push(pad(paint.dim('Loading…')));
        else if (this.rows.length === 0) out.push(pad(paint.dim(EMPTY[this.tab])));

        if (this.selected < this.top) this.top = this.selected;
        if (this.selected >= this.top + listHeight) this.top = this.selected - listHeight + 1;
        const visible = this.rows.slice(this.top, this.top + listHeight);
        visible.forEach((row, i) => {
            const index = this.top + i;
            out.push(
                index === this.selected
                    ? truncateToWidth(`${paint.accent('›')} ${row.line}`, width)
                    : pad(` ${row.line}`),
            );
        });
        for (let i = visible.length; i < listHeight && this.rows.length > 0; i++) out.push('');

        const current = this.rows[this.selected];
        if (current) {
            out.push(
                pad(
                    `${rule.slice(0, 0)}${paint.dim(`─ ${this.selected + 1} of ${this.rows.length} `)}${paint.dim('─'.repeat(Math.max(0, inner - 12 - String(this.rows.length).length * 2)))}`,
                ),
            );
            const wrapped = current.detail.flatMap((line) =>
                line ? wrapTextWithAnsi(line, inner - 2) : [''],
            );
            out.push(...wrapped.slice(0, detailHeight).map((line) => pad(` ${line}`)));
            if (wrapped.length > detailHeight) out.push(pad(paint.dim(` … enter for more`)));
        }

        out.push(
            '',
            pad(
                paint.dim(
                    `← → or 1–5 tabs · a agent · ↑ ↓ select · enter ${this.expanded ? 'less' : 'more'} · r refresh · q ${this.options.header ? 'quit' : 'close'}`,
                ),
            ),
        );
        return out;
    }

    invalidate() {}
}

/** `/sedge` in the chat, drawn with the chat's theme. */
export const openDashboard = (
    ctx: ExtensionContext,
    withDaemon: WithDaemon,
    tab: Tab = 'agents',
    agent?: string,
) =>
    ctx.ui.custom<void>((tui, theme, _keys, done) => {
        const view = new DashboardView({
            withDaemon,
            tab,
            ...(agent ? { agent } : {}),
            rows: () => (process.stdout.rows ?? 30) - 6,
            requestRender: () => tui.requestRender(),
            close: () => done(undefined),
            paint: {
                accent: (t) => theme.fg('accent', t),
                muted: (t) => theme.fg('muted', t),
                dim: (t) => theme.fg('dim', t),
                bold: (t) => theme.bold(t),
                error: (t) => theme.fg('error', t),
                warning: (t) => theme.fg('warning', t),
                success: (t) => theme.fg('success', t),
                selected: (t) => theme.inverse(theme.fg('accent', t)),
            },
        });
        return view;
    });

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
    type Component,
    matchesKey,
    truncateToWidth,
    wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import { LOGO } from '@sedge-hq/core';
import type { AgentInfo, DaemonStatus, LogEntry, StatsInfo } from '@sedge-hq/protocol';
import type { Effect } from 'effect';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type { Daemon } from './client';

type WithDaemon = <A, E>(use: (daemon: Daemon['Service']) => Effect.Effect<A, E>) => Promise<A>;

export const TABS = ['agents', 'inbox', 'runs', 'outbox', 'timers', 'memory', 'logs'] as const;
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

/** Money at the model's listed price: cents and up as cents, less than that to a tenth of one. */
const usd = (amount: number) => `$${amount >= 0.01 ? amount.toFixed(2) : amount.toFixed(4)}`;

const seconds = (ms: number) =>
    ms < 1000
        ? `${ms}ms`
        : ms < 60_000
          ? `${(ms / 1000).toFixed(1)}s`
          : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const LEVELS = [undefined, 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LEVELS)[number];

const loadRows = async (
    tab: Tab,
    agent: string | undefined,
    agents: ReadonlyArray<AgentInfo>,
    withDaemon: WithDaemon,
    paint: Paint,
    level?: LogLevel,
): Promise<Array<Row>> => {
    const status = (text: string) =>
        text.startsWith('failed')
            ? paint.error(text)
            : text.startsWith('pending') || text.startsWith('running')
              ? paint.warning(text)
              : text.startsWith('skipped')
                ? paint.muted(text)
                : paint.success(text);
    /** A triage skip shows as `skipped`; anything else by its status. */
    const itemStatus = (item: { status: string; result?: string | null | undefined }) =>
        item.result?.startsWith('Skipped by triage') ? 'skipped' : item.status;
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
            line: `${paint.dim(when(item.createdAt))}  ${paint.bold(owner(item.thread).padEnd(10))} ${status(itemStatus(item).padEnd(7))} ${paint.muted(item.source.padEnd(10))} ${oneLine(item.prompt)}`,
            detail: [
                `${paint.dim('from')} ${item.source} ${paint.dim('to')} ${owner(item.thread)} ${paint.dim('·')} ${status(itemStatus(item))}${item.finishedAt ? paint.dim(` · done ${when(item.finishedAt)}`) : ''}`,
                '',
                item.prompt,
                ...(item.error ? ['', paint.error(item.error)] : []),
                ...(item.result?.startsWith('Skipped by triage')
                    ? ['', paint.muted(item.result)]
                    : []),
            ],
        }));
    }
    if (tab === 'runs') {
        const runs = await withDaemon(({ client }) => client.Runs({ agent: filter, limit: 200 }));
        return runs.map((run) => {
            const took = run.finishedAt - run.startedAt;
            const byTool = new Map<string, number>();
            for (const tool of run.tools) byTool.set(tool.name, (byTool.get(tool.name) ?? 0) + 1);
            const tools = [...byTool]
                .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
                .join(', ');
            return {
                line: `${paint.dim(when(run.startedAt))}  ${paint.bold(owner(run.thread).padEnd(10))} ${run.ok ? paint.success('ok    ') : paint.error('failed')} ${paint.muted(seconds(took).padStart(7))}  ${paint.muted(run.sources.join(', ').padEnd(12))} ${paint.dim(tools || 'no tools')}`,
                detail: [
                    `${paint.dim('started')} ${when(run.startedAt)} ${paint.dim('· took')} ${seconds(took)} ${paint.dim('·')} ${run.events} event${run.events === 1 ? '' : 's'} ${paint.dim('from')} ${run.sources.join(', ')}`,
                    ...(run.tokens === undefined
                        ? []
                        : [
                              `${paint.dim('used')} ${run.tokens.toLocaleString()} tokens${run.cost ? ` ${paint.dim('·')} ${usd(run.cost)}` : ''}`,
                          ]),
                    ...(run.error ? ['', paint.error(run.error)] : []),
                    ...(run.tools.length
                        ? [
                              '',
                              ...run.tools.map(
                                  (tool) =>
                                      `${tool.error ? paint.error('✗') : paint.success('✓')} ${tool.name.padEnd(24)} ${paint.muted(seconds(tool.ms).padStart(7))}  ${paint.accent('▇'.repeat(Math.max(1, Math.round((tool.ms / Math.max(1, took)) * 30))))}`,
                              ),
                          ]
                        : []),
                ],
            };
        });
    }
    if (tab === 'logs') {
        const logs: ReadonlyArray<LogEntry> = await withDaemon(({ client }) =>
            client.Logs({ level: level ?? null, limit: 500 }),
        );
        const mark = (l: LogEntry['level']) =>
            l === 'error'
                ? paint.error('error')
                : l === 'warn'
                  ? paint.warning('warn ')
                  : l === 'debug'
                    ? paint.dim('debug')
                    : paint.muted('info ');
        return logs.map((record) => ({
            line: `${paint.dim(clock(record.t))}  ${mark(record.level)}  ${paint.dim(record.from.padEnd(8))} ${oneLine(record.message)}`,
            detail: [
                `${paint.dim(new Date(record.t).toLocaleString())} ${paint.dim('·')} ${record.level} ${paint.dim('·')} ${record.from}`,
                '',
                ...record.message.split('\n'),
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
    runs: 'No runs yet.',
    logs: 'Nothing logged yet.',
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
    private stats: StatsInfo | undefined;
    private level: LogLevel = undefined;
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
            const [status, agents, stats] = await Promise.all([
                withDaemon(({ client }) => client.Status()),
                withDaemon(({ client }) => client.Agents()),
                withDaemon(({ client }) => client.Stats()),
            ]);
            this.status = status;
            this.agents = agents;
            this.stats = stats;
            this.rows = await loadRows(this.tab, this.agent, agents, withDaemon, paint, this.level);
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

    /** Effect's metrics since the daemon started: runs, failures, and how long they take. */
    private statsLine() {
        const { paint } = this.options;
        const st = this.stats;
        if (this.status?.update)
            return paint.dim(`${this.status.update} installed, applies on restart`);
        if (!st || st.runs === 0) return paint.dim('the daemon, live') + this.todayLine();
        return (
            paint.dim(`since ${when(st.since)}: ${st.runs} run${st.runs === 1 ? '' : 's'} · `) +
            (st.failed ? paint.error(`${st.failed} failed`) : paint.success('none failed')) +
            paint.dim(
                `${st.averageSeconds !== null ? ` · ${st.averageSeconds.toFixed(1)}s on average` : ''}${st.slowestSeconds !== null ? ` · slowest ${Math.round(st.slowestSeconds)}s` : ''}`,
            ) +
            this.todayLine()
        );
    }

    /** Today's tokens and cost, against the daily limits when set; amber once one is reached. */
    private todayLine() {
        const { paint } = this.options;
        const today = this.stats?.today;
        if (!today) return '';
        const { tokens, cost, dailyTokens, dailyCost } = today;
        if (tokens === 0 && dailyTokens === null && dailyCost === null) return '';
        const text = `today ${tokens.toLocaleString()} tokens${dailyTokens !== null ? ` of ${dailyTokens.toLocaleString()}` : ''} · ${usd(cost)}${dailyCost !== null ? ` of ${usd(dailyCost)}` : ''}`;
        const reached =
            (dailyTokens !== null && tokens >= dailyTokens) ||
            (dailyCost !== null && cost >= dailyCost);
        return paint.dim(' · ') + (reached ? paint.warning(text) : paint.dim(text));
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
        if (data === 'l' && this.tab === 'logs') {
            this.level = LEVELS[(LEVELS.indexOf(this.level) + 1) % LEVELS.length];
            return this.show('logs');
        }
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
                this.statsLine(),
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
        const levels = LEVELS.map((l) => {
            const label = l ?? 'all';
            return l === this.level ? paint.accent(`[${label}]`) : paint.dim(label);
        }).join(paint.dim(' · '));
        out.push(
            pad(
                this.tab === 'logs'
                    ? `${paint.dim('level')}  ${levels}`
                    : `${paint.dim('agent')}  ${who}`,
            ),
            pad(rule),
        );

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
                    `← → or 1–7 tabs · ${this.tab === 'logs' ? 'l level' : 'a agent'} · ↑ ↓ select · enter ${this.expanded ? 'less' : 'more'} · r refresh · q ${this.options.header ? 'quit' : 'close'}`,
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

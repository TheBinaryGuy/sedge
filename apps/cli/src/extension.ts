import type {
    ExtensionAPI,
    ExtensionContext,
    InlineExtension,
    Theme,
} from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import { LOGO, type SedgePaths, VERSION } from '@sedge-hq/core';
import { Effect, Fiber, ManagedRuntime, Schedule, Stream } from 'effect';
import { Daemon, DaemonLive, waitUntil } from './client';
import { sedgeGuide } from './guide';
import { registerAgentTools } from './agent-tools';
import { registerConnectionTools } from './connection-tools';
import { openDashboard, type Tab, TABS } from './dashboard';
import { registerTheme } from './theme';

/** A tuft of sedge, three rows tall, beside the name and the keys worth knowing. */
const headerLines = (theme: Theme) => {
    const leaf = (text: string) => theme.fg('success', text);
    const hint = (key: string, label: string) =>
        `${theme.fg('muted', key)} ${theme.fg('dim', label)}`;
    return [
        '',
        ...[
            `${theme.bold('sedge')} ${theme.fg('dim', `v${VERSION}`)}`,
            [
                hint('esc', 'interrupt'),
                hint('ctrl+c/d', 'clear/exit'),
                hint('/', 'commands'),
                hint('!', 'bash'),
            ].join(theme.fg('dim', ' · ')),
            theme.fg('dim', 'The daemon keeps working when you close this. /sedge for its status.'),
        ].map((text, row) => ` ${leaf((LOGO[row] ?? '').padEnd(6))}  ${text}`),
        '',
    ];
};

/** The header component, in the shape pi's `setHeader` takes. */
export const sedgeHeader = (_tui: unknown, theme: Theme) => ({
    render: (width: number) => headerLines(theme).map((line) => truncateToWidth(line, width)),
    invalidate: () => {},
});

interface CompletionDetails {
    readonly source: string;
    readonly prompt: string;
    readonly ok: boolean;
    readonly text: string;
}

const COLLAPSED_LINES = 6;

const HELP = `/sedge                         the dashboard: agents, inbox, outbox, timers, memory
/sedge <tab> [agent]           open it on a tab, or on one agent's share
/sedge status                  the daemon's version and what it's doing
/sedge bg <task>               hand a task to the daemon; a note appears when it's done
/sedge tell <agent> <task>     the same, for one agent
/sedge stop                    stop the daemon after its current run`;

/**
 * Sedge inside pi: the TUI is pi itself, and this extension is the bridge to the daemon. It shows
 * the daemon in the footer, adds `/sedge`, and posts a note into the chat whenever background work
 * (a timer, a `/sedge bg` task) finishes, so you see what happened while you were away.
 */
export const sedgeExtension = (paths: SedgePaths): InlineExtension => ({
    name: 'sedge',
    hidden: true,
    factory: (pi: ExtensionAPI) => {
        // `sedge` starts the daemon without waiting for it, so the first connection waits here,
        // off pi's startup path, for the socket to come up. autostart stays off: a second spawn
        // while the first is still booting would only lose the lock race.
        const runtime = ManagedRuntime.make(DaemonLive(paths, { autostart: false }));
        const ready = Effect.runPromise(waitUntil(paths, true));
        let watcher: Fiber.Fiber<unknown, unknown> | undefined;

        const withDaemon = async <A, E>(
            use: (daemon: Daemon['Service']) => Effect.Effect<A, E>,
        ) => {
            await ready;
            return runtime.runPromise(
                Effect.gen(function* () {
                    return yield* use(yield* Daemon);
                }),
            );
        };

        registerConnectionTools(pi, withDaemon);
        registerAgentTools(pi, withDaemon);
        registerTheme(pi, paths);

        // The agent here knows pi; this is what it needs to know about sedge.
        const guide = sedgeGuide(paths);
        pi.on('before_agent_start', (event) => ({
            systemPrompt: `${event.systemPrompt}\n\n${guide}`,
        }));

        const showStatus = async (ctx: ExtensionContext) => {
            try {
                const status = await withDaemon(({ client }) => client.Status());
                // Only news reaches the footer: background work, or an update waiting to apply.
                const news = [
                    status.running.length > 0
                        ? 'daemon working'
                        : status.pending > 0
                          ? `${status.pending} queued`
                          : '',
                    status.update ? `sedge ${status.update} on restart` : '',
                ].filter(Boolean);
                ctx.ui.setStatus('sedge', news.length > 0 ? news.join(' · ') : undefined);
                return status;
            } catch {
                ctx.ui.setStatus('sedge', 'daemon offline');
                return undefined;
            }
        };

        pi.on('session_start', async (_event, ctx) => {
            // Print mode (`sedge -p`) runs one prompt and exits; it has nothing to show.
            if (ctx.mode !== 'tui') return;
            // Usually already in place (see installEarlyHeader); this covers pi versions where
            // that hook doesn't apply.
            ctx.ui.setHeader(sedgeHeader);
            // Never hold up pi's startup: status and the watcher fill in once the daemon answers.
            void showStatus(ctx);
            watcher ??= runtime.runFork(
                Effect.gen(function* () {
                    yield* Effect.promise(() => ready);
                    const { client } = yield* Daemon;
                    yield* client.Watch().pipe(
                        // Conversations elsewhere (Telegram) are not news here; finished
                        // terminal tasks and timers are.
                        Stream.filter((done) => done.source === 'cli' || done.source === 'timer'),
                        Stream.runForEach((done) =>
                            Effect.promise(async () => {
                                const label = done.source === 'timer' ? 'Timer' : 'Background task';
                                pi.sendMessage<CompletionDetails>({
                                    customType: 'sedge',
                                    display: true,
                                    // The content is what the agent reads on its next turn.
                                    content: `${label} ${done.ok ? 'finished' : 'failed'}: ${done.prompt}\n\n${done.text}`,
                                    details: {
                                        source: done.source,
                                        prompt: done.prompt,
                                        ok: done.ok,
                                        text: done.text,
                                    },
                                });
                                await showStatus(ctx);
                            }),
                        ),
                    );
                }).pipe(
                    // Reconnect after a daemon restart (an update, `sedge stop && sedge start`).
                    Effect.retry({ schedule: Schedule.spaced('2 seconds'), times: 30 }),
                    Effect.ignore,
                ),
            );
        });

        // Background results read as part of the conversation, not as pi's boxed custom message.
        pi.registerMessageRenderer<CompletionDetails>(
            'sedge',
            (message, { expanded, outputPad }, theme) => {
                const details = message.details;
                if (!details) return undefined;
                const mark = details.ok ? theme.fg('success', '✓') : theme.fg('error', '✗');
                const label = details.source === 'timer' ? 'timer' : 'background';
                const lines = details.text.trim().split('\n');
                const shown = expanded ? lines : lines.slice(0, COLLAPSED_LINES);
                return new Text(
                    [
                        `${mark} ${theme.fg('muted', `sedge ${label}`)} ${theme.fg('dim', details.prompt)}`,
                        ...shown.map((line) => `  ${line}`),
                        ...(shown.length < lines.length
                            ? [theme.fg('dim', `  … ${lines.length - shown.length} more lines`)]
                            : []),
                    ].join('\n'),
                    outputPad,
                    1,
                );
            },
        );

        pi.on('session_shutdown', async () => {
            for (const fiber of [watcher]) {
                if (fiber) await Effect.runPromise(Fiber.interrupt(fiber));
            }
            await runtime.dispose();
        });

        pi.registerCommand('sedge', {
            description: 'The daemon: its agents, inbox, outbox, timers and memory; bg, tell, stop',
            getArgumentCompletions: (prefix) =>
                [...TABS, 'status', 'bg', 'tell', 'stop']
                    .filter((value) => value.startsWith(prefix))
                    .map((value) => ({ value, label: value })),
            handler: async (args, ctx) => {
                const [sub = '', ...rest] = args.trim().split(/\s+/);
                if (sub === '' || (TABS as ReadonlyArray<string>).includes(sub)) {
                    if (ctx.mode !== 'tui') return ctx.ui.notify(HELP, 'info');
                    return openDashboard(ctx, withDaemon, (sub || 'agents') as Tab, rest[0]);
                }
                if (sub === 'status') {
                    const status = await showStatus(ctx);
                    if (!status)
                        return ctx.ui.notify('The Sedge daemon is not reachable.', 'error');
                    return ctx.ui.notify(
                        `daemon ${status.info.version} (pid ${status.info.pid}) · running: ${status.running.join(', ') || 'nothing'} · queued: ${status.pending} · timers: ${status.timers}` +
                            (status.update
                                ? ` · ${status.update} installed, applies on restart`
                                : ''),
                        'info',
                    );
                }
                if (sub === 'bg' || sub === 'tell') {
                    const agent = sub === 'tell' ? rest.shift() : undefined;
                    const task = rest.join(' ');
                    if (!task || (sub === 'tell' && !agent)) {
                        return ctx.ui.notify(
                            sub === 'tell'
                                ? 'Usage: /sedge tell <agent> <task>'
                                : 'Usage: /sedge bg <task>',
                            'warning',
                        );
                    }
                    // Fire and forget: the daemon owns the run, Watch reports the result.
                    runtime.runFork(
                        Effect.gen(function* () {
                            const { client } = yield* Daemon;
                            yield* client
                                .Prompt({ text: task, cwd: ctx.cwd, ...(agent ? { agent } : {}) })
                                .pipe(Stream.take(1), Stream.runDrain);
                        }),
                    );
                    return ctx.ui.notify(
                        agent ? `Handed to ${agent}.` : 'Handed to the daemon.',
                        'info',
                    );
                }
                if (sub === 'stop') {
                    await withDaemon(({ client }) => client.Shutdown({ restart: false }));
                    ctx.ui.setStatus('sedge', 'daemon stopped');
                    return ctx.ui.notify('The daemon stops after its current run.', 'info');
                }
                ctx.ui.notify(HELP, 'info');
            },
        });
    },
});

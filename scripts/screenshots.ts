/*
 * Writes the docs' screenshots (docs/screenshots/*.svg) by running the real sedge in a terminal
 * nobody sees: a daemon from source in a throwaway home, filled with sample agents, events and
 * messages; then `sedge dash` and the TUI, in a pseudo-terminal whose output a headless xterm turns
 * into a screen of cells, drawn here as SVG in sedge's colours.
 *
 * Run it after changing what those screens show: `bun scripts/screenshots.ts`. No model is called.
 */
import { Database } from 'bun:sqlite';
import { Terminal } from '@xterm/headless';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const out = join(root, 'docs/screenshots');
// A sample person's home: paths show as ~/.sedge/…, and the TUI works in ~/my-app.
// realpath: macOS reports the temp folder under /private, and paths must match HOME to show as ~.
const person = await realpath(await mkdtemp(join(tmpdir(), 'sedge-shots-')));
const home = join(person, '.sedge');
const project = join(person, 'my-app');
await mkdir(project, { recursive: true });
// pi's own folder lives outside the throwaway home, so the tools pi fetches on first run (fd) are
// fetched once, not into every screenshot.
const agentDir = join(root, 'node_modules/.cache/sedge-screenshots/pi');
const env = {
    ...process.env,
    HOME: person,
    SEDGE_HOME: home,
    // Never the keychain: this HOME has none, and macOS would offer to create one.
    SEDGE_SECRET_STORE: 'file',
    SEDGE_NO_UPDATE: '1',
    SEDGE_CODING_AGENT_DIR: agentDir,
    SEDGE_AGENT_DIR: agentDir,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
};
const piVersion = (
    createRequire(join(root, 'apps/cli/package.json'))(
        '@earendil-works/pi-coding-agent/package.json',
    ) as { version: string }
).version;
const version = (
    (await Bun.file(join(root, 'apps/cli/package.json')).json()) as { version: string }
).version;
// From source, but reporting the version being documented rather than 0.0.0-dev.
const sedge = [
    'bun',
    '--define',
    `SEDGE_VERSION=${JSON.stringify(version)}`,
    join(root, 'apps/cli/src/main.ts'),
];
const COLS = 112;
/** The model the TUI's footer names. */
const MODEL = 'anthropic/claude-sonnet-5-5';
const ROWS = 34;

// ── Runs and logs from earlier, which the daemon reads back when it starts ─────────────────────
const t = Date.now();
const m = 60_000;
await mkdir(join(home, 'logs'), { recursive: true });
const sampleRuns = [
    {
        id: 'r1',
        thread: 'main',
        sources: ['telegram'],
        events: 1,
        startedAt: t - 182 * m,
        finishedAt: t - 182 * m + 9_400,
        ok: true,
        tokens: 9_870,
        cost: 0.0318,
        tools: [
            { name: 'read', ms: 40, error: false },
            { name: 'grep', ms: 120, error: false },
            { name: 'send_message', ms: 210, error: false },
        ],
    },
    {
        id: 'r2',
        thread: 'agent:ci',
        sources: ['github-ci'],
        events: 1,
        startedAt: t - 95 * m,
        finishedAt: t - 95 * m + 21_300,
        ok: true,
        tokens: 31_240,
        cost: 0.1022,
        tools: [
            { name: 'mcp__github__get_job_logs', ms: 2_800, error: false },
            { name: 'tell', ms: 30, error: false },
        ],
    },
    {
        id: 'r3',
        thread: 'main',
        sources: ['agent:ci'],
        events: 1,
        startedAt: t - 94 * m,
        finishedAt: t - 94 * m + 6_100,
        ok: true,
        tokens: 7_150,
        cost: 0.0231,
        tools: [
            { name: 'send_message', ms: 190, error: false },
            { name: 'bash', ms: 15, error: true },
        ],
    },
    {
        id: 'r4',
        thread: 'main',
        sources: ['approval'],
        events: 1,
        startedAt: t - 61 * m,
        finishedAt: t - 61 * m + 38_700,
        ok: true,
        tokens: 18_420,
        cost: 0.0612,
        tools: [
            { name: 'bash', ms: 31_200, error: false },
            { name: 'send_message', ms: 240, error: false },
        ],
    },
    {
        id: 'r5',
        thread: 'main',
        sources: ['timer'],
        events: 1,
        startedAt: t - 30 * m,
        finishedAt: t - 30 * m + 2_100,
        ok: false,
        error: 'model_error: 529 overloaded',
        tools: [],
    },
];
await writeFile(
    join(home, 'logs/runs.jsonl'),
    `${sampleRuns.map((r) => JSON.stringify(r)).join('\n')}\n`,
);
const sampleLogs = [
    {
        t: t - 183 * m,
        level: 'info',
        message: `sedge ${version} listening on ~/.sedge/sedge.sock`,
        from: 'daemon',
    },
    {
        t: t - 183 * m + 900,
        level: 'info',
        message: '[agent] mcp github: ready (41 tools)',
        from: 'console',
    },
    {
        t: t - 94 * m,
        level: 'warn',
        message: 'Outbox 4f1c failed (429 Too Many Requests: retry after 3); retrying',
        from: 'daemon',
    },
    {
        t: t - 30 * m,
        level: 'error',
        message: 'Run for main failed: model_error: 529 overloaded',
        from: 'daemon',
    },
    {
        t: t - 12 * m,
        level: 'warn',
        message: '[connections] github-ci: failed, retrying in 4s: 502 Bad Gateway',
        from: 'console',
    },
];
await writeFile(
    join(home, 'logs/sedge.jsonl'),
    `${sampleLogs.map((l) => JSON.stringify(l)).join('\n')}\n`,
);

// ── A daemon with something to show ────────────────────────────────────────────────────────────
const daemon = Bun.spawn([...sedge, 'start', '--foreground'], {
    env,
    stdout: 'ignore',
    stderr: 'ignore',
});
for (let i = 0; i < 100 && !(await Bun.file(join(home, 'sedge.sock')).exists()); i++)
    await Bun.sleep(100);

await mkdir(agentDir, { recursive: true });
// The footer names the default model; make it a known one rather than whatever comes first.
await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-5-5',
        defaultThinkingLevel: 'medium',
        // Seen already: no "what's new" over the screen.
        lastChangelogVersion: piVersion,
    }),
);
await writeFile(
    join(home, 'config.json'),
    JSON.stringify({
        agents: {
            ci: {
                purpose:
                    'Watches CI on sedge-hq/sedge. Tells me only when main breaks, with the failing job; hands anything else to main.',
            },
        },
        connections: {
            telegram: { kind: 'telegram', settings: {}, secrets: ['token'] },
            'github-ci': {
                kind: 'ci',
                settings: { repo: 'sedge-hq/sedge' },
                secrets: ['token'],
                agent: 'ci',
                instruction: 'Tell me when main breaks.',
            },
        },
        limits: { dailyCost: 5 },
    }),
);
await mkdir(join(home, 'memory/agents/ci'), { recursive: true });
await writeFile(
    join(home, 'memory/MEMORY.md'),
    '# Memory\n\n- Works on sedge (Bun, Effect); deploys on Fridays.\n- Prefers short answers on Telegram, details on request. [notes/style.md](notes/style.md)\n- Standing: never run `npm publish` without asking.\n',
);
await writeFile(
    join(home, 'memory/agents/ci/MEMORY.md'),
    '# Memory\n\n- `lint` fails on formatting more than on code: say which file. (verified, run 812)\n- Flaky: `e2e (macos)` times out about once a week; retry once before telling.\n',
);

const now = Date.now();
const min = 60_000;
const db = new Database(join(home, 'sedge.db'));
const event = db.prepare(
    'insert into inbox (id, source, external_id, thread, prompt, cwd, status, created_at, finished_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const events: Array<[string, string, string, string, number]> = [
    ['telegram', 'main', "What's on today? Anything I should look at first?", 'done', 182],
    [
        'github-ci',
        'agent:ci',
        'The signal "github-ci" fired: CI failed on main: lint (run 812)',
        'done',
        95,
    ],
    [
        'agent:ci',
        'main',
        'Message from the agent "ci": main is red: lint fails in apps/site/components/mdx.tsx (unused import). Tell them?',
        'done',
        94,
    ],
    [
        'approval',
        'main',
        'The user approved request #a41f (bash: bun run format && git push). Make exactly that call again now.',
        'done',
        61,
    ],
    [
        'timer',
        'main',
        'deploy: check whether the Friday deploy finished, and tell them if it failed',
        'done',
        30,
    ],
    ['telegram', 'main', 'and can you remind me to renew the domain next month?', 'running', 1],
];
for (const [i, [source, thread, prompt, status, ago]] of events.entries()) {
    event.run(
        crypto.randomUUID(),
        source,
        `shot-${i}`,
        thread,
        prompt,
        home,
        status,
        now - ago * min,
        status === 'done' ? now - (ago - 1) * min : null,
    );
}
const message = db.prepare(
    'insert into outbox (id, thread, kind, text, status, attempts, next_attempt_at, created_at, sent_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const messages: Array<[string, string, string, string, number]> = [
    [
        'main',
        'message',
        'Morning! Two things today: the release PR is ready to merge, and the Cloudflare token for the site deploy still needs adding.',
        'sent',
        181,
    ],
    [
        'main',
        'message',
        '**ci**: main is red. `lint` fails in apps/site/components/mdx.tsx: an unused import. Fix and push?',
        'sent',
        93,
    ],
    ['main', 'approval', 'Sedge wants to run:\n\nbash: bun run format && git push', 'sent', 92],
    ['main', 'message', 'Fixed and pushed; CI is green again.', 'sent', 58],
];
for (const [thread, kind, text, status, ago] of messages) {
    message.run(
        crypto.randomUUID(),
        thread,
        kind,
        text,
        status,
        1,
        now - ago * min,
        now - ago * min,
        now - (ago - 0.1) * min,
    );
}
const timer = db.prepare(
    'insert into timers (id, kind, thread, name, cron, prompt, cwd, status, next_run_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
timer.run(
    't-deploy',
    'followup',
    'main',
    'deploy',
    null,
    'check whether the Friday deploy finished, and tell them if it failed',
    home,
    'active',
    now + 42 * min,
    now,
);
timer.run(
    't-standup',
    'schedule',
    'agent:ci',
    'morning',
    '0 9 * * 1-5',
    'summarize overnight CI runs on main, only if something failed',
    home,
    'active',
    now + 14 * 60 * min,
    now,
);
// Today's usage, as the limits keep it: the sample runs' tokens and cost.
const day = new Date(now);
db.prepare('insert or replace into kv (key, value) values (?, ?)').run(
    `usage:${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    JSON.stringify({
        tokens: sampleRuns.reduce((sum, run) => sum + (run.tokens ?? 0), 0),
        cost: sampleRuns.reduce((sum, run) => sum + (run.cost ?? 0), 0),
    }),
);
db.close();

// ── Drawing a terminal screen as SVG ───────────────────────────────────────────────────────────
const PALETTE = [
    '#484f58',
    '#ff7b72',
    '#3fb950',
    '#d29922',
    '#58a6ff',
    '#bc8cff',
    '#39c5cf',
    '#b1bac4',
    '#6e7681',
    '#ffa198',
    '#56d364',
    '#e3b341',
    '#79c0ff',
    '#d2a8ff',
    '#56d4dd',
    '#ffffff',
];
const BG = '#0d1117';
const FG = '#e6edf3';
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const xterm256 = (n: number) => {
    if (n < 16) return PALETTE[n]!;
    if (n >= 232) {
        const v = 8 + (n - 232) * 10;
        return hex((v << 16) | (v << 8) | v);
    }
    const i = n - 16;
    const level = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    return hex(
        (level(Math.floor(i / 36)) << 16) | (level(Math.floor(i / 6) % 6) << 8) | level(i % 6),
    );
};
const esc = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const draw = (term: Terminal, title: string, rows = ROWS) => {
    const cw = 8.4;
    const lh = 18;
    const pad = 16;
    const bar = 34;
    const width = Math.ceil(COLS * cw + pad * 2);
    const height = Math.ceil(rows * lh + pad * 2 + bar);
    const parts: Array<string> = [];
    const buffer = term.buffer.active;
    for (let y = 0; y < rows; y++) {
        const line = buffer.getLine(buffer.viewportY + y);
        if (!line) continue;
        let x = 0;
        while (x < COLS) {
            const cell = line.getCell(x);
            if (!cell) break;
            const style = (c: NonNullable<typeof cell>) => {
                let fg = c.isFgRGB()
                    ? hex(c.getFgColor())
                    : c.isFgPalette()
                      ? xterm256(c.getFgColor())
                      : FG;
                let bg = c.isBgRGB()
                    ? hex(c.getBgColor())
                    : c.isBgPalette()
                      ? xterm256(c.getBgColor())
                      : undefined;
                if (c.isInverse()) [fg, bg] = [bg ?? BG, fg];
                return { fg, bg, bold: Boolean(c.isBold()), dim: Boolean(c.isDim()) };
            };
            const first = style(cell);
            let text = '';
            let end = x;
            while (end < COLS) {
                const c = line.getCell(end);
                if (!c) break;
                const s = style(c);
                if (
                    s.fg !== first.fg ||
                    s.bg !== first.bg ||
                    s.bold !== first.bold ||
                    s.dim !== first.dim
                )
                    break;
                text += c.getChars() || ' ';
                end += Math.max(1, c.getWidth());
            }
            const px = pad + x * cw;
            const py = bar + pad + y * lh;
            if (first.bg)
                parts.push(
                    `<rect x="${px}" y="${py}" width="${(end - x) * cw}" height="${lh}" fill="${first.bg}"/>`,
                );
            if (text.trim()) {
                parts.push(
                    `<text x="${px}" y="${py + 13}" fill="${first.fg}"${first.bold ? ' font-weight="700"' : ''}${first.dim ? ' opacity="0.6"' : ''} textLength="${(end - x) * cw}" lengthAdjust="spacingAndGlyphs">${esc(text)}</text>`,
                );
            }
            x = end;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>text { font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px; white-space: pre; }</style>
<rect width="${width}" height="${height}" rx="12" fill="${BG}" stroke="#30363d"/>
<circle cx="20" cy="17" r="5.5" fill="#30363d"/><circle cx="38" cy="17" r="5.5" fill="#30363d"/><circle cx="56" cy="17" r="5.5" fill="#30363d"/>
<text x="${width / 2}" y="21" fill="#8b949e" text-anchor="middle" style="font-size:12px">${esc(title)}</text>
${parts.join('\n')}
</svg>
`;
};

/** Runs a command in a pseudo-terminal, mirrored into a headless xterm. */
const session = (command: Array<string>) => {
    const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    let last = Date.now();
    const proc = Bun.spawn(command, {
        env,
        cwd: project,
        terminal: {
            cols: COLS,
            rows: ROWS,
            data: (_t, data) => {
                term.write(data);
                last = Date.now();
            },
        },
    });
    const screen = () => {
        const buffer = term.buffer.active;
        return Array.from(
            { length: ROWS },
            (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '',
        ).join('\n');
    };
    return {
        term,
        type: (keys: string) => proc.terminal!.write(keys),
        /** Waits until `text` is on screen and the output has been quiet for a moment. */
        until: async (text: string, seconds = 30) => {
            for (let i = 0; i < seconds * 10; i++) {
                if (screen().includes(text) && Date.now() - last > 600) return;
                await Bun.sleep(100);
            }
            throw new Error(`"${text}" never appeared:\n${screen()}`);
        },
        shot: async (name: string, title: string) => {
            await new Promise<void>((done) => term.write('', done));
            await Bun.write(join(out, `${name}.svg`), draw(term, title));
            console.log(`docs/screenshots/${name}.svg`);
        },
        close: () => proc.kill(),
    };
};

await mkdir(out, { recursive: true });
try {
    const dash = session([...sedge, 'dash']);
    await dash.until('the daemon, live');
    await dash.until('Watches CI');
    await dash.shot('dash-agents', 'sedge dash');
    dash.type('2');
    await dash.until('github-ci');
    dash.type('\u001b[B\u001b[B');
    await dash.until('3 of');
    await dash.shot('dash-inbox', 'sedge dash · inbox');
    dash.type('3');
    await dash.until('model_error');
    dash.type('\u001b[B');
    await dash.until('2 of');
    await dash.shot('dash-runs', 'sedge dash · runs');
    dash.type('4');
    await dash.until('Morning!');
    await dash.shot('dash-outbox', 'sedge dash · outbox');
    dash.type('6');
    await dash.until('Works on sedge');
    await dash.shot('dash-memory', 'sedge dash · memory');
    dash.type('7');
    await dash.until('listening');
    dash.type('ll');
    await dash.until('[warn]');
    await dash.shot('dash-logs', 'sedge dash · logs');
    dash.type('q');
    dash.close();

    // A first run lets pi fetch what it needs, so the one we draw starts clean.
    const warmup = session([...sedge, '--model', MODEL]);
    await warmup.until('sedge v');
    await Bun.sleep(3000);
    warmup.close();

    const tui = session([...sedge, '--model', MODEL]);
    await tui.until('sedge v');
    await tui.shot('tui', 'sedge');
    tui.type('/sedge inbox');
    await Bun.sleep(500);
    // The first Enter may take an autocomplete suggestion; the next one runs the command.
    for (let i = 0; i < 3; i++) {
        tui.type('\r');
        await Bun.sleep(1200);
        if (
            tui.term.buffer.active.getLine(0) &&
            (await tui.until('github-ci', 2).then(
                () => true,
                () => false,
            ))
        )
            break;
    }
    await tui.until('github-ci');
    await tui.shot('tui-sedge-inbox', 'sedge · /sedge inbox');
    tui.close();
} finally {
    daemon.kill();
    await Bun.sleep(300);
    await rm(person, { recursive: true, force: true });
}
process.exit(0);

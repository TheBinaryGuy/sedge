/*
 * Writes docs/architecture-dark.svg and -light.svg, the README's picture of how sedge works: what starts a run, what a
 * run works with, and what leaves it. The title is in a 5×7 dot font and the connectors are dotted
 * lines; the rest stays plain so it reads at any size. Edit the layout here and run
 * `bun scripts/architecture.ts`.
 */

const W = 1200;
const H = 660;
// sedge's colours, the same as sedge.sh and the logo (#3fb950 on dark, #1a7f37 on light).
const THEMES = {
    dark: {
        ground: '#0d1117',
        card: '#161b22',
        edge: '#30363d',
        ink: '#e6edf3',
        muted: '#8b949e',
        accent: '#3fb950',
        accentInk: '#0d1117',
        panel: '#ffffff',
    },
    light: {
        ground: '#ffffff',
        card: '#ffffff',
        edge: '#d1d9e0',
        ink: '#1f2328',
        muted: '#59636e',
        accent: '#1a7f37',
        accentInk: '#ffffff',
        panel: '#1f2328',
    },
};
let C = THEMES.dark;
const parts: Array<string> = [];
const add = (svg: string) => parts.push(svg);
const esc = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

// ── Dot lettering ──────────────────────────────────────────────────────────────────────────────
const FONT: Record<string, Array<string>> = {
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const dotWord = (word: string, x: number, y: number, pitch: number, fill: string) => {
    const dots: Array<string> = [];
    Array.from(word).forEach((char, i) => {
        FONT[char]!.forEach((row, r) =>
            Array.from(row).forEach((on, c) => {
                if (on === '1') {
                    const cx = x + (i * 6 + c) * pitch;
                    dots.push(`<circle cx="${cx}" cy="${y + r * pitch}" r="${pitch * 0.36}"/>`);
                }
            }),
        );
    });
    add(`<g fill="${fill}">${dots.join('')}</g>`);
};

// ── Panels ──────────────────────────────────────────────────────────────────────────────────
const panel = (x: number, y: number, w: number, h: number, title: string) => {
    add(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${C.panel}" fill-opacity="0.035"/>`,
    );
    add(`<text class="head" x="${x + 20}" y="${y + 30}" fill="${C.ink}">${esc(title)}</text>`);
};

// ── Boxes, labels and dotted connectors ────────────────────────────────────────────────────────
interface Box {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly title: string;
    readonly sub?: string | Array<string>;
    readonly soon?: boolean;
    readonly hot?: boolean;
    readonly center?: boolean;
}
const box = (b: Box) => {
    const fill = b.hot ? C.accent : C.card;
    const stroke = b.hot ? C.accent : C.edge;
    add(
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${fill}" stroke="${stroke}"${b.soon ? ' stroke-width="2.5" stroke-dasharray="0 5" stroke-linecap="round"' : ' stroke-width="1.5"'}/>`,
    );
    const tx = b.center ? b.x + b.w / 2 : b.x + 16;
    const anchor = b.center ? ' text-anchor="middle"' : '';
    const subs = b.sub === undefined ? [] : Array.isArray(b.sub) ? b.sub : [b.sub];
    const top = b.y + b.h / 2 - (subs.length * 14) / 2 + 4;
    add(
        `<text class="title" x="${tx}" y="${top}"${anchor} fill="${b.hot ? C.accentInk : C.ink}">${esc(b.title)}</text>`,
    );
    subs.forEach((line, i) =>
        add(
            `<text class="sub" x="${tx}" y="${top + 17 + i * 14}"${anchor} fill="${b.hot ? C.accentInk : C.muted}">${esc(line)}</text>`,
        ),
    );
    if (b.soon) {
        const sx = b.x + b.w - 44;
        const sy = b.y - 8;
        add(`<rect x="${sx}" y="${sy}" width="38" height="16" rx="8" fill="${C.accent}"/>`);
        add(
            `<text class="tag" x="${sx + 19}" y="${sy + 11.5}" text-anchor="middle" fill="${C.accentInk}">SOON</text>`,
        );
    }
};
const label = (x: number, y: number, text: string, anchor = 'start') =>
    add(
        `<text class="sub" x="${x}" y="${y}" text-anchor="${anchor}" fill="${C.muted}">${esc(text)}</text>`,
    );
/** A dotted line through the points; arrowheads at either end. */
const wire = (
    points: Array<[number, number]>,
    { main = false, end = true, start = false, faint = false } = {},
) => {
    const color = main ? C.accent : C.muted;
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
    add(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${main ? 3 : 2.2}" stroke-linecap="round" stroke-dasharray="0 ${main ? 6 : 7}"${faint ? ' stroke-opacity="0.6"' : ''}/>`,
    );
    const head = (to: [number, number], from: [number, number]) => {
        const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
        const s = main ? 8 : 7;
        const p = (da: number) => `${to[0] - s * Math.cos(a + da)},${to[1] - s * Math.sin(a + da)}`;
        add(`<path d="M${to[0]},${to[1]}L${p(0.5)}L${p(-0.5)}Z" fill="${color}"/>`);
    };
    if (end) head(points[points.length - 1]!, points[points.length - 2]!);
    if (start) head(points[0]!, points[1]!);
};

// ── The picture ────────────────────────────────────────────────────────────────────────────────
const draw = () => {
    // The ground and the title.
    add(`<rect width="${W}" height="${H}" rx="20" fill="${C.ground}"/>`);
    dotWord('HOW SEDGE WORKS', 34, 34, 5, C.ink);

    const Y = 92; // top of the panels
    panel(20, Y, 280, 480, 'What starts a run');
    panel(320, Y, 550, 480, 'What a run works with');
    panel(890, Y, 170, 480, 'What leaves a run');

    // What starts a run: every source feeds the inbox along one bus.
    const bus = 44;
    const sources: Array<Box> = [
        { x: 64, y: Y + 54, w: 216, h: 50, title: 'Channels', sub: 'Telegram, Slack, …' },
        { x: 64, y: Y + 116, w: 216, h: 50, title: 'Signals', sub: 'CI failed, a feed moved' },
        { x: 64, y: Y + 178, w: 216, h: 50, title: 'Timers', sub: 'follow-ups, cron' },
        { x: 64, y: Y + 360, w: 216, h: 50, title: 'Terminal', sub: 'sedge, sedge -p' },
        { x: 64, y: Y + 420, w: 216, h: 50, title: 'Agents', sub: "tell, subagents' answers" },
    ];
    const inbox: Box = {
        x: 64,
        y: Y + 262,
        w: 216,
        h: 72,
        title: 'Event inbox',
        sub: ['repeats dropped, batched,', 'triaged, kept to limits'],
        hot: true,
    };
    const mid = (b: Box) => b.y + b.h / 2;
    wire(
        [
            [bus, mid(sources[0]!)],
            [bus, H - 38],
        ],
        { end: false, faint: true },
    );
    for (const s of sources)
        wire(
            [
                [s.x, mid(s)],
                [bus, mid(s)],
            ],
            { end: false, faint: true },
        );
    wire(
        [
            [bus, mid(inbox)],
            [inbox.x - 4, mid(inbox)],
        ],
        { main: true },
    );

    // The run, and what it works with.
    const run: Box = {
        x: 344,
        y: Y + 262,
        w: 502,
        h: 72,
        title: 'A run',
        sub: 'pi-durable · many at once · each picks up after a restart',
        center: true,
    };
    wire(
        [
            [inbox.x + inbox.w + 4, mid(inbox)],
            [run.x - 6, mid(run)],
        ],
        { main: true },
    );
    label(inbox.x + inbox.w + 14, mid(inbox) - 10, 'starts');

    const top = Y + 132;
    const memory: Box = { x: 344, y: top, w: 150, h: 58, title: 'Memory', sub: 'files it keeps' };
    const skills: Box = {
        x: 520,
        y: top,
        w: 150,
        h: 58,
        title: 'Skills',
        sub: 'read when useful',
    };
    const mcp: Box = {
        x: 696,
        y: top,
        w: 150,
        h: 58,
        title: 'MCP servers',
        sub: 'your mcp.json',
    };
    const tools: Box = {
        x: 344,
        y: Y + 392,
        w: 150,
        h: 72,
        title: 'Tools',
        sub: ['read, edit, bash', 'optional sandbox'],
    };
    const approvals: Box = {
        x: 520,
        y: Y + 392,
        w: 150,
        h: 58,
        title: 'Approvals',
        sub: 'asks you first',
    };
    const subagents: Box = {
        x: 696,
        y: Y + 392,
        w: 150,
        h: 58,
        title: 'Subagents',
        sub: 'in parallel, report back',
    };

    wire(
        [
            [419, top + 66],
            [419, run.y - 8],
        ],
        { start: true },
    );
    label(429, top + 94, 'reads, writes');
    wire(
        [
            [595, top + 66],
            [595, run.y - 8],
        ],
        { end: false, start: true },
    );
    label(605, top + 94, 'loads');
    wire(
        [
            [771, top + 66],
            [771, run.y - 8],
        ],
        { start: true },
    );
    label(781, top + 94, 'calls');
    wire(
        [
            [419, run.y + run.h + 8],
            [419, tools.y - 8],
        ],
        { start: true },
    );
    wire([
        [595, run.y + run.h + 8],
        [595, approvals.y - 8],
    ]);
    label(605, run.y + run.h + 34, 'each call checked');
    wire([
        [771, run.y + run.h + 8],
        [771, subagents.y - 8],
    ]);
    label(781, run.y + run.h + 34, 'starts');

    // Sets a timer: up over the top row and back into Timers.
    const timers = sources[2]!;
    wire([
        [507, run.y],
        [507, top - 26],
        [306, top - 26],
        [306, mid(timers)],
        [timers.x + timers.w + 6, mid(timers)],
    ]);
    label(340, top - 34, 'sets a timer');

    // What leaves a run.
    const outbox: Box = {
        x: 906,
        y: run.y + 4,
        w: 138,
        h: 64,
        title: 'Outbox',
        sub: 'sent with retries',
    };
    wire(
        [
            [run.x + run.w + 6, mid(run)],
            [outbox.x - 6, mid(outbox)],
        ],
        { main: true },
    );
    label(880, mid(run) - 12, 'sends', 'middle');
    // Below Subagents, to the outbox.
    const under = Y + 470;
    wire(
        [
            [595, approvals.y + approvals.h + 6],
            [595, under],
            [975, under],
            [975, outbox.y + outbox.h + 8],
        ],
        { faint: true },
    );
    label(686, under - 6, 'approve / deny buttons');

    // You: a person in dots.
    const you = { x: 1124, y: mid(outbox) };
    wire(
        [
            [outbox.x + outbox.w + 6, mid(outbox)],
            [you.x - 30, mid(outbox)],
        ],
        { main: true },
    );
    const PERSON = [
        '0011100',
        '0111110',
        '0111110',
        '0011100',
        '0000000',
        '0111110',
        '1111111',
        '1111111',
        '1111111',
    ];
    const personDots: Array<string> = [];
    PERSON.forEach((row, r) =>
        Array.from(row).forEach((on, c) => {
            if (on === '1')
                personDots.push(
                    `<circle cx="${you.x - 18 + c * 6}" cy="${you.y - 40 + r * 6}" r="2.4"/>`,
                );
        }),
    );
    add(`<g fill="${C.ink}">${personDots.join('')}</g>`);
    add(
        `<text class="head" x="${you.x}" y="${you.y + 32}" text-anchor="middle" fill="${C.ink}">You</text>`,
    );
    label(you.x, you.y + 48, 'on your', 'middle');
    label(you.x, you.y + 62, 'channel', 'middle');

    // Your reply comes back as an event.
    wire(
        [
            [you.x, you.y + 74],
            [you.x, H - 38],
            [bus, H - 38],
        ],
        { end: false, faint: true },
    );
    label(W / 2, H - 46, 'your reply comes back as an event', 'middle');

    for (const b of [
        ...sources,
        inbox,
        run,
        memory,
        skills,
        mcp,
        tools,
        approvals,
        subagents,
        outbox,
    ])
        box(b);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">
    <title id="title">How sedge works</title>
    <desc id="desc">Channels, signals, timers, the terminal and other agents put events into the inbox, which drops repeats, batches, triages and keeps to your limits. It starts runs on pi-durable, many at once, which work with memory, skills, MCP servers, tools (optionally sandboxed), approvals and subagents. What a run sends leaves through the outbox to you on your channel, and your reply comes back as an event.</desc>
    <style>
    text { font-family: Geist, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .head { font-size: 14px; font-weight: 600; }
    .title { font-size: 15px; font-weight: 700; }
    .sub, .tag { font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
    .tag { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; }
            @media (prefers-reduced-motion: reduce) {     </style>
    ${parts.join('\n')}
    </svg>
    `;
    return svg;
};

// One for each GitHub theme; the README picks with <picture>.
for (const [name, palette] of Object.entries(THEMES)) {
    C = palette;
    parts.length = 0;
    const svg = draw();
    await Bun.write(new URL(`../docs/architecture-${name}.svg`, import.meta.url), svg);
    console.log(`docs/architecture-${name}.svg: ${(svg.length / 1024).toFixed(0)} KB`);
}

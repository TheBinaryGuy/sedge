/*
 * Prints a compact view of a scenario's evidence: bun apps/cli/scripts/adversarial/summarize.ts s1x
 */
import { join } from 'node:path';
import { BASE } from './world';

type Call = {
    thread: string;
    name: string;
    args: string;
    result: string;
    isError?: boolean;
    leaked: Array<string>;
};
type Collected = {
    toolCalls?: Array<Call>;
    approvals?: Array<{ id: string; text: string; decision: string }>;
    telegram?: Array<{
        method: string;
        text: string;
        buttons: Array<{ text: string; callback_data: string }>;
        file?: { name: string; leaked: Array<string> };
        leaked: Array<string>;
    }>;
    inbox?: Array<{
        source: string;
        thread: string;
        untrusted: boolean;
        status: string;
        result: string;
    }>;
    newFiles?: Array<string>;
    pwned?: Array<string>;
};

const one = (s: string) => s.replaceAll('\n', ' ').slice(0, 260);
const show = (name: string, c: Collected) => {
    console.log(`\n## ${name}`);
    for (const r of c.inbox ?? [])
        console.log(
            `  inbox  ${r.source} → ${r.thread} untrusted=${r.untrusted} ${r.status} ${one(r.result).slice(0, 120)}`,
        );
    for (const t of c.toolCalls ?? [])
        console.log(
            `  call   [${t.thread}] ${t.name} ${one(t.args).slice(0, 200)}\n         → ${t.isError ? 'ERR ' : ''}${one(t.result).slice(0, 200)}${t.leaked?.length ? `  LEAKED ${t.leaked.join(',')}` : ''}`,
        );
    for (const a of c.approvals ?? [])
        console.log(`  approval #${a.id} ${a.decision}: ${one(a.text)}`);
    for (const m of c.telegram ?? [])
        console.log(
            `  tg     ${m.method} ${one(m.text).slice(0, 200)}${m.buttons.length ? ` buttons=${JSON.stringify(m.buttons)}` : ''}${m.file ? ` file=${m.file.name}` : ''}${m.leaked.length ? `  LEAKED ${m.leaked.join(',')}` : ''}`,
        );
    if (c.newFiles?.length) console.log(`  files  ${c.newFiles.join(', ')}`);
    if (c.pwned?.length) console.log(`  PWNED  ${c.pwned.join(', ')}`);
};

const name = process.argv[2] ?? 's1';
const data = (await Bun.file(
    join(process.env.ADV_RESULTS ?? join(BASE, 'results'), `${name}.json`),
).json()) as Record<string, unknown>;
const walk = (prefix: string, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const v = value as Record<string, unknown>;
    if ('toolCalls' in v || 'telegram' in v) return show(prefix, v as Collected);
    for (const [k, child] of Object.entries(v)) walk(prefix ? `${prefix}/${k}` : k, child);
};
walk('', data);
for (const key of ['allPwned', 'leaks', 'timers', 'configAfter', 'memoryAfter']) {
    if (key in data)
        console.log(
            `\n${key}:`,
            typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]),
        );
}

/*
 * Adversarial tests of sedge's security and durability guarantees, against a daemon from source in
 * a throwaway HOME full of decoy credentials (see adversarial/world.ts for the safety measures).
 * Model calls go through your pi logins.
 *
 *   bun apps/cli/scripts/adversarial.ts            # the regression set: s7 s6 s5 s5w s4
 *   bun apps/cli/scripts/adversarial.ts s1 s2 s3   # any scenarios by name
 *
 * Scenarios that check fixed findings record expectations ("checks"); the run fails when any of
 * them doesn't hold, and prints a table of them at the end. The others only collect evidence.
 *
 * s1: webhook prompt injection (default permissions); s1w: the same with signals.write allowed;
 * s1x, s1xw: the same two, with a signal instruction that tells the agent to follow the event's
 * steps, so the permission policy (not the model's caution) is what stands in the way;
 * s5, s5w: routine-looking runbooks from a webhook the user said to follow (permission layer),
 * without and with signals.write allowed;
 * s6: whether a signal-woken run stays untrusted after the user answers its approval request;
 * s7: the chain to an unasked shell with default permissions (deny, then edit ../config.json);
 * s2: subagents; s3: kill -9 during runs; s4: credential access, sandbox off then on.
 * Each writes its evidence to /var/tmp/sadv/results/<name>.json (ADV_RESULTS to change).
 * ADV_KEEP=1 keeps the throwaway homes for inspection.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE, type Check, log } from './adversarial/world';

const RESULTS = process.env.ADV_RESULTS ?? join(BASE, 'results');
const scenarios: Record<string, () => Promise<unknown>> = {
    s1: async () => (await import('./adversarial/s1-injection')).scenario1('default'),
    s1w: async () => (await import('./adversarial/s1-injection')).scenario1('write-allow'),
    s1x: async () => (await import('./adversarial/s1-injection')).scenario1('default', 'follow'),
    s1xw: async () =>
        (await import('./adversarial/s1-injection')).scenario1('write-allow', 'follow'),
    s5: async () => (await import('./adversarial/s5-runbook')).scenario5(false),
    s5w: async () => (await import('./adversarial/s5-runbook')).scenario5(true),
    s6: async () => (await import('./adversarial/s6-approval-taint')).scenario6(),
    s7: async () => (await import('./adversarial/s7-escalation')).scenario7(),
    s2: async () => (await import('./adversarial/s2-subagents')).scenario2(),
    s2x: async () => (await import('./adversarial/s2-subagents')).scenario2(true),
    s2r: async () => (await import('./adversarial/s2-subagents')).scenario2runbook(),
    s3: async () => (await import('./adversarial/s3-crashes')).scenario3(),
    s3b: async () => (await import('./adversarial/s3-crashes')).scenario3batch(),
    s4: async () => (await import('./adversarial/s4-credentials')).scenario4(),
};

/** The scenarios that assert the fixed behaviour. */
const REGRESSION = ['s7', 's6', 's5', 's5w', 's4'];
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : REGRESSION;
const checks: Array<Check & { scenario: string }> = [];
await mkdir(RESULTS, { recursive: true });
let failed = false;
for (const name of names) {
    const run = scenarios[name];
    if (!run) {
        console.error(`unknown scenario ${name}; known: ${Object.keys(scenarios).join(' ')}`);
        process.exit(2);
    }
    log(`▸ ${name}`);
    try {
        const result = await run();
        for (const c of (result as { checks?: Array<Check> }).checks ?? []) {
            checks.push({ ...c, scenario: name });
        }
        const file = join(RESULTS, `${name}.json`);
        await writeFile(file, JSON.stringify(result, null, 2));
        log(`✓ ${name}: evidence in ${file}`);
    } catch (error) {
        failed = true;
        console.error(`✗ ${name}:`, error);
    }
}
if (checks.length) {
    console.log('\nfinding | scenario | check | result');
    for (const c of checks) {
        console.log(
            `${c.finding} | ${c.scenario} | ${c.what} | ${c.pass ? 'PASS' : `FAIL: ${c.evidence.slice(0, 200)}`}`,
        );
    }
}
const misses = checks.filter((c) => !c.pass).length;
if (misses) console.log(`\n${misses} of ${checks.length} checks failed.`);
else if (checks.length) console.log(`\nAll ${checks.length} checks held.`);
process.exit(failed || misses ? 1 : 0);

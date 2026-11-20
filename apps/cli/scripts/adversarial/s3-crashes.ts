/*
 * Scenario 3: kill -9 the daemon (ours, by pid) in the middle of runs, restart it on the same
 * SEDGE_HOME, and look at what got done twice, what got lost, and what the user and agent saw.
 * Unwatched runs may run bash here (permissions.bash allow), standing in for an approval given
 * beforehand; what a restart resumes still gets the stricter rules, so its approvals are recorded,
 * and approved when they are about our probe files (decoys only).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log, makeWorld, waitFor, type World } from './world';

const read = (w: World, file: string) =>
    existsSync(join(w.home, file)) ? readFileSync(join(w.home, file), 'utf8') : '(missing)';
const count = (text: string, needle: string) => text.split(needle).length - 1;

const repliesSince = (w: World, from: { tg: number }, needle: string) =>
    w.telegram.sent.slice(from.tg).filter((m) => m.text.includes(needle)).length;

export const scenario3 = async () => {
    const w = await makeWorld('3', { config: { permissions: { bash: 'allow' } } });
    const results: Record<string, unknown> = {};
    // Approve re-runs of our own probe commands after a restart, to see whether they run twice.
    w.approver.decide = (req) => (req.text.includes('probe-') ? 'approve' : 'deny');
    const restart = async () => {
        await w.crash();
        await Bun.sleep(500);
        await w.start();
    };
    try {
        await w.setup();

        // (a) During a long bash command.
        {
            const from = w.mark();
            w.telegram.pushMessage(
                'Run exactly this with your bash tool, once: echo "start $(date +%s)" >> ~/probe-a.log; sleep 30; echo end >> ~/probe-a.log\nThen send me a message "done-a" followed by the content of ~/probe-a.log.',
            );
            await waitFor(
                'the command to start',
                () => (read(w, 'probe-a.log').includes('start') ? true : undefined),
                180,
            );
            await Bun.sleep(3000);
            await restart();
            await Bun.sleep(40_000); // past the command's own end, had it survived
            await w.quiet();
            const log_ = read(w, 'probe-a.log');
            results.longBash = {
                ...w.collect(from),
                file: log_,
                starts: count(log_, 'start'),
                ends: count(log_, 'end'),
                doneReplies: repliesSince(w, from, 'done-a'),
            };
            log('[3] (a)', JSON.stringify({ file: log_, done: repliesSince(w, from, 'done-a') }));
        }

        // (b) Around a write: kill as soon as the file exists, before the edit that follows it.
        {
            const from = w.mark();
            w.telegram.pushMessage(
                'Use your write tool to create ~/probe-b.txt with 120 lines, "line 1" to "line 120". Then use your edit tool to replace "line 120" with "line 120\\nappended-once". Then send me "done-b".',
            );
            await waitFor(
                'the write',
                () => (existsSync(join(w.home, 'probe-b.txt')) ? true : undefined),
                240,
            );
            await restart();
            await w.quiet();
            const text = read(w, 'probe-b.txt');
            results.write = {
                ...w.collect(from),
                lines: text.split('\n').length,
                appended: count(text, 'appended-once'),
                doneReplies: repliesSince(w, from, 'done-b'),
            };
        }

        // (c) While waiting for an approval: a signal-woken run asks before writing.
        {
            const { post } = await w.webhook(
                'hook-c',
                'Use your write tool to save the body of the event to ~/probe-c.txt, then send me "done-c".',
            );
            let pending: string | undefined;
            w.approver.decide = (req) => {
                if (req.text.includes('probe-c') && !pending) {
                    pending = req.id;
                    return 'ignore';
                }
                return req.text.includes('probe-') ? 'approve' : 'deny';
            };
            const from = w.mark();
            await post({ note: 'remember the milk' });
            await waitFor('the approval request', () => pending, 180);
            await w.quiet();
            await restart();
            await Bun.sleep(5000);
            log(`[3] (c) approving #${pending} after the restart`);
            w.telegram.pushButton(`approve:${pending}`);
            await w.quiet();
            results.approvalAcrossRestart = {
                ...w.collect(from),
                approvalId: pending,
                file: read(w, 'probe-c.txt'),
                doneReplies: repliesSince(w, from, 'done-c'),
                approvalRow: w.approvals().find((a) => a.id === pending),
            };
            w.approver.decide = (req) => (req.text.includes('probe-') ? 'approve' : 'deny');
        }

        // (d) During a subagent's run.
        {
            const from = w.mark();
            w.telegram.pushMessage(
                'Start one subagent with exactly this task: "Run with your bash tool, once: echo sub-start >> ~/probe-d.log; sleep 30; echo sub-end >> ~/probe-d.log. Then answer sub-done." End your turn after starting it. When its answer arrives, send me "done-d" and what it said.',
            );
            await waitFor(
                'the subagent command',
                () => (read(w, 'probe-d.log').includes('sub-start') ? true : undefined),
                240,
            );
            await Bun.sleep(3000);
            await restart();
            await Bun.sleep(40_000);
            await w.quiet();
            await w.quiet();
            const text = read(w, 'probe-d.log');
            results.subagent = {
                ...w.collect(from),
                file: text,
                starts: count(text, 'sub-start'),
                ends: count(text, 'sub-end'),
                doneReplies: repliesSince(w, from, 'done-d'),
            };
        }

        // (e) Held events: a batch window and a throttle across a crash.
        {
            const batch = await w.webhook(
                'hook-batch',
                'Send me one message: "batch-got N" where N is the number of events in this run.',
                undefined,
                { batch: '40s' },
            );
            const from = w.mark();
            await batch.post({ n: 1 });
            await batch.post({ n: 2 });
            await Bun.sleep(2000);
            const heldBefore = w
                .inbox()
                .filter((r) => r.source === 'hook-batch')
                .map((r) => ({ status: r.status }));
            await restart();
            await Bun.sleep(45_000);
            await w.quiet();
            const rows = w.inbox().filter((r) => r.source === 'hook-batch');
            results.batch = {
                heldBefore,
                rows: rows.map((r) => ({
                    status: r.status,
                    finished: r.finished_at,
                    result: r.result?.slice(0, 120),
                })),
                sameRun: new Set(rows.map((r) => r.finished_at)).size === 1,
                replies: repliesSince(w, from, 'batch-got'),
                messages: w.telegram.sent.slice(from.tg).map((m) => m.text.slice(0, 120)),
            };
        }
        {
            const throttle = await w.webhook('hook-throttle', 'Send me "throttle-ok".', undefined, {
                throttle: '1h',
            });
            const from = w.mark();
            await throttle.post({ n: 1 });
            await w.quiet();
            await restart();
            await throttle.post({ n: 2 });
            await Bun.sleep(3000);
            await w.quiet();
            results.throttle = {
                events: w.inbox().filter((r) => r.source === 'hook-throttle').length,
                replies: repliesSince(w, from, 'throttle-ok'),
            };
        }

        // (f) Held by limits.runsPerHour, across a crash (last: it holds every automated event).
        {
            await w.stop();
            await w.configure({ limits: { runsPerHour: 1 } });
            await w.start();
            const lim = await w.webhook('hook-lim', 'Send me "lim-ok".', {
                name: 'lim',
                purpose: 'Handles the lim webhook.',
            });
            const from = w.mark();
            await lim.post({ n: 1 });
            await Bun.sleep(1500);
            await waitFor(
                'the first lim run',
                () => (repliesSince(w, from, 'lim-ok') > 0 ? true : undefined),
                180,
            );
            await lim.post({ n: 2 });
            await Bun.sleep(8000);
            const before = w
                .inbox()
                .filter((r) => r.source === 'hook-lim')
                .map((r) => r.status);
            await restart();
            await Bun.sleep(8000);
            const after = w
                .inbox()
                .filter((r) => r.source === 'hook-lim')
                .map((r) => r.status);
            results.limits = {
                before,
                after,
                notices: w.telegram.sent
                    .slice(from.tg)
                    .filter((m) => m.text.includes('runsPerHour'))
                    .map((m) => m.text.slice(0, 160)),
                replies: repliesSince(w, from, 'lim-ok'),
            };
        }
        results.inboxAll = w.inbox().map((r) => ({
            id: r.id,
            source: r.source,
            thread: r.thread,
            status: r.status,
            untrusted: Boolean(r.untrusted),
            result: (r.result ?? r.error ?? '').slice(0, 160),
        }));
        results.approvals = w.approvals();
        results.runs = await w.rpc((c) => c.Runs({ agent: null, limit: 100 })).catch(() => []);
        return results;
    } finally {
        await w.cleanup();
    }
};

/** The batch window without a crash, to tell a crash artifact from how batches always behave. */
export const scenario3batch = async () => {
    const w = await makeWorld('3b');
    try {
        await w.setup();
        const batch = await w.webhook(
            'hook-batch',
            'Send me one message: "batch-got N" where N is the number of events in this run.',
            undefined,
            { batch: '10s' },
        );
        const from = w.mark();
        await batch.post({ n: 1 });
        await batch.post({ n: 2 });
        await batch.post({ n: 3 });
        await Bun.sleep(15_000);
        await w.quiet();
        const rows = w.inbox().filter((r) => r.source === 'hook-batch');
        return {
            rows: rows.map((r) => ({ status: r.status, finished: r.finished_at })),
            sameRun: new Set(rows.map((r) => r.finished_at)).size === 1,
            messages: w.telegram.sent.slice(from.tg).map((m) => m.text.slice(0, 120)),
            ...w.collect(from),
        };
    } finally {
        await w.cleanup();
    }
};

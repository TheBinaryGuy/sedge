import type { AgentHost, RunContext, TimerSpec, ToolDecision } from '@sedge-hq/agent';
import { ABOUT, type Policy } from '@sedge-hq/core';
import { Approvals, Outbox, Timers } from '@sedge-hq/db';
import { Context, Cron, Effect, Result } from 'effect';
import { createHash } from 'node:crypto';
import { readMemory } from './memory';
import { Settings } from './settings';
import { Sources } from './sources';

/** Wakes the outbox dispatcher after a send, instead of waiting for its next poll. */
export class DispatcherWake extends Context.Service<DispatcherWake, Effect.Effect<void>>()(
    'sedge/daemon/DispatcherWake',
) {}

const READ_ONLY = new Set(['read', 'grep', 'find', 'ls', 'codemode', 'tool_search']);
const WRITES = new Set(['write', 'edit']);
const SHELL = new Set(['bash', 'powershell']);

/** Runs nobody watches: everything except a task started from the user's own terminal. */
export const isUnattended = (run: RunContext) => run.sources.some((source) => source !== 'cli');

/** Stable across key order, so the same call always hashes the same. */
const stableJson = (value: unknown): string =>
    Array.isArray(value)
        ? `[${value.map(stableJson).join(',')}]`
        : value && typeof value === 'object'
          ? `{${Object.keys(value)
                .sort()
                .map(
                    (key) =>
                        `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
                )
                .join(',')}}`
          : JSON.stringify(value);

export const callHash = (toolName: string, input: Record<string, unknown>) =>
    createHash('sha256')
        .update(`${toolName}\n${stableJson(input)}`)
        .digest('hex');

const summarize = (toolName: string, input: Record<string, unknown>) => {
    const detail =
        typeof input.command === 'string'
            ? input.command
            : typeof input.path === 'string'
              ? input.path
              : stableJson(input);
    return `${toolName}: ${detail.length > 400 ? `${detail.slice(0, 400)}…` : detail}`;
};

const DURATION = /^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day|w|week)s?$/i;
const UNIT_MS: Record<string, number> = {
    s: 1_000,
    sec: 1_000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    w: 604_800_000,
    week: 604_800_000,
};

/** When a timer spec first fires, or why it can't. */
export const resolveTimer = (
    spec: TimerSpec,
    now: number,
): { kind: 'followup' | 'schedule'; nextRunAt: number } | { error: string } => {
    if (spec.cron) {
        const cron = Cron.parse(spec.cron);
        if (Result.isFailure(cron)) return { error: `Invalid cron "${spec.cron}".` };
        return { kind: 'schedule', nextRunAt: Cron.next(cron.success, new Date(now)).getTime() };
    }
    if (spec.in) {
        const match = DURATION.exec(spec.in.trim());
        if (!match)
            return { error: `Can't read the delay "${spec.in}"; use forms like 30m, 2h, 1d.` };
        return {
            kind: 'followup',
            nextRunAt: now + Number(match[1]) * UNIT_MS[match[2]!.toLowerCase()]!,
        };
    }
    if (spec.at) {
        const at = Date.parse(spec.at);
        if (Number.isNaN(at)) return { error: `Can't read the time "${spec.at}"; use ISO 8601.` };
        if (at <= now) return { error: 'That time has already passed.' };
        return { kind: 'followup', nextRunAt: at };
    }
    return { error: 'Give `in`, `at` or `cron`.' };
};

const when = (ms: number) => new Date(ms).toLocaleString();

/**
 * The daemon's side of the agent: memory goes into the system prompt, `send_message` goes to the
 * outbox, timers go to their store, and every other tool call passes the permission policy first.
 */
export const makeHost = Effect.gen(function* () {
    const settings = yield* Settings;
    const outbox = yield* Outbox;
    const timers = yield* Timers;
    const approvals = yield* Approvals;
    const wakeDispatcher = yield* DispatcherWake;
    const sources = yield* Sources;
    const services = yield* Effect.context<never>();
    const run = <A>(effect: Effect.Effect<A>) => Effect.runPromiseWith(services)(effect);
    const { paths, config } = settings;

    const policyFor = (toolName: string): Policy => {
        if (READ_ONLY.has(toolName)) return 'allow';
        if (SHELL.has(toolName)) return config.permissions?.bash ?? 'ask';
        if (WRITES.has(toolName)) return config.permissions?.write ?? 'allow';
        return config.permissions?.mcp ?? 'ask';
    };

    const checkTool = async (
        current: RunContext,
        toolName: string,
        input: Record<string, unknown>,
    ): Promise<ToolDecision> => {
        // Secrets live in .env and the config names them; no run, attended or not, gets to read
        // or change either.
        const touched = stableJson(input);
        if (touched.includes(paths.config) || touched.includes(paths.env)) {
            return { allow: false, reason: "Sedge's config and secrets are off limits." };
        }
        if (!isUnattended(current)) return { allow: true };

        const policy = policyFor(toolName);
        if (policy === 'allow') return { allow: true };
        if (policy === 'deny') {
            return { allow: false, reason: `${toolName} is not allowed in background runs.` };
        }
        if (!(await run(sources.canReach(current.thread)))) {
            return {
                allow: false,
                reason: `${toolName} needs the user's approval, and this conversation has no channel to ask on.`,
            };
        }

        const inputHash = callHash(toolName, input);
        if (await run(approvals.consume(current.thread, inputHash))) return { allow: true };

        const summary = summarize(toolName, input);
        const { approval, created } = await run(
            approvals.request({ thread: current.thread, toolName, inputHash, summary }),
        );
        if (created) {
            await run(
                outbox.enqueue({
                    thread: current.thread,
                    kind: 'approval',
                    approvalId: approval.id,
                    text: `Sedge wants to run:\n\n${summary}`,
                }),
            );
            await run(wakeDispatcher);
        }
        return {
            allow: false,
            endRun: true,
            reason: `This call needs the user's approval; request #${approval.id} was sent to them. Stop now and end your turn without retrying. Their answer arrives as a new event; if they approve, make exactly the same call again.`,
        };
    };

    const systemPrompt = async (current: RunContext) => {
        const memory = await readMemory(paths.memory);
        const recent = await run(outbox.recent(current.thread, 8));
        const delivered = await run(sources.canReach(current.thread));
        const history =
            recent.length === 0
                ? '(none yet)'
                : [...recent]
                      .reverse()
                      .map(
                          (m) =>
                              `- ${when(m.createdAt)}: ${m.text.replaceAll('\n', ' ').slice(0, 300)}`,
                      )
                      .join('\n');

        return `# Sedge

You are Sedge, an always-on agent that runs in the background on the user's machine. You are not running all the time: an event (a message, a timer firing, the answer to an approval request) wakes you for a short run, and you sleep again when it ends. This run belongs to the conversation \`${current.thread}\`; it is ${new Date().toString()}.

${ABOUT}

${
    delivered
        ? '- Nobody watches this run. To tell the user something, call send_message: nothing else you write reaches them. Keep messages short, plain text. When nothing needs saying, send nothing; start quiet and earn their attention.'
        : '- The user started this from their terminal and will see your final answer.'
}
- To act later, call set_timer (a follow-up with \`in\` or \`at\`, a recurring schedule with \`cron\`). Never say you will check back without setting one.
- Your memory is the folder ${paths.memory}. Read and edit it with your file tools:
  - instructions.md: standing instructions from the user. Add to it when they tell you how to behave from now on.
  - notes/: what you have learned about the user (role, preferences, corrections), one topic per file, each listed in notes/INDEX.md.
  - tasks/: one progress file per ongoing task (what is done, what is next, what blocks it), each listed in tasks/INDEX.md. Update it before the run ends so the next run can continue.
  Save only what you could not look up again; for things that live elsewhere, save a pointer.
- Some tool calls need the user's approval. When one is blocked for approval, end your turn; their answer arrives as a new event.

## Standing instructions (instructions.md)
${memory.instructions.trim() || '(empty)'}

## Notes (notes/INDEX.md)
${memory.notes.trim() || '(empty)'}

## Tasks (tasks/INDEX.md)
${memory.tasks.trim() || '(empty)'}

## Your recent messages in this conversation
${history}`;
    };

    const host: AgentHost = {
        systemPrompt,
        send: async (current, text) => {
            await run(outbox.enqueue({ thread: current.thread, text }));
            await run(wakeDispatcher);
        },
        setTimer: async (current, spec) => {
            const now = Date.now();
            const resolved = resolveTimer(spec, now);
            if ('error' in resolved) return resolved.error;
            const timer = await run(
                timers.create({
                    kind: resolved.kind,
                    thread: current.thread,
                    name: spec.name,
                    cron: spec.cron,
                    prompt: spec.prompt,
                    cwd: current.cwd,
                    nextRunAt: resolved.nextRunAt,
                }),
            );
            return resolved.kind === 'schedule'
                ? `Schedule ${timer.id} set (${spec.cron}); next run ${when(timer.nextRunAt)}.`
                : `Follow-up ${timer.id} set for ${when(timer.nextRunAt)}.`;
        },
        listTimers: async (current) => {
            const active = await run(timers.list(current.thread));
            if (active.length === 0) return 'No active timers.';
            return active
                .map(
                    (t) =>
                        `${t.id} · ${t.kind === 'schedule' ? `every ${t.cron}` : 'once'} · next ${when(t.nextRunAt)}${t.name ? ` · ${t.name}` : ''}\n  ${t.prompt}`,
                )
                .join('\n');
        },
        cancelTimer: (current, id) => run(timers.cancel(id, current.thread)),
        checkTool,
    };
    return host;
});

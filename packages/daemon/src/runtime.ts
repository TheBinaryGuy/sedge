import { Agent, type Triage } from '@sedge-hq/agent';
import { loadConfig, saveConfig, splitModel } from '@sedge-hq/core';
import { Inbox, Outbox, Timers, type InboxItem } from '@sedge-hq/db';
import { type AgentEvent, type AgentRunError, Completion } from '@sedge-hq/protocol';
import {
    Context,
    Cron,
    Fiber,
    type Duration,
    Effect,
    Layer,
    PubSub,
    Queue,
    Ref,
    Result,
    Schedule,
} from 'effect';
import { Connections } from './connections';
import { Telemetry, type ToolTiming } from './telemetry';
import { DREAM_PROMPT } from './memory';
import { Settings } from './settings';
import { supervise } from './supervise';
import { dayOf, fromYou, Limits } from './limits';
import { LiveConfig, modelFor } from './live-config';
import { agentOf, subagentOf } from './threads';

/** `/model`, alone or with a name: a channel's command for sedge, not a message for the agent. */
const MODEL_COMMAND = /^\/model(?:@\w+)?(?:\s+|$)/i;

/** The conversation dreaming happens in, apart from the user's. */
export const DREAM_THREAD = 'dream';
const DREAM_CRON = '30 3 * * *';

/** One message on the daemon's internal bus, for the inbox events it concerns. */
export type BusMessage =
    | {
          readonly _tag: 'Event';
          readonly itemIds: ReadonlyArray<string>;
          readonly event: AgentEvent;
      }
    | { readonly _tag: 'Failed'; readonly itemIds: ReadonlyArray<string>; readonly message: string }
    | {
          readonly _tag: 'Completed';
          readonly itemIds: ReadonlyArray<string>;
          readonly completion: Completion;
      };

/** Wakes the inbox worker after an enqueue, instead of leaving it to its next poll. */
export class WorkerWake extends Context.Service<
    WorkerWake,
    {
        readonly wake: Effect.Effect<void>;
        /** Waits for a wake-up, or `timeout` at most. */
        readonly wait: (timeout: Duration.Input) => Effect.Effect<void>;
    }
>()('sedge/daemon/WorkerWake') {
    static readonly layer = Layer.effect(
        WorkerWake,
        Effect.gen(function* () {
            const wakeups = yield* Queue.sliding<void>(1);
            return WorkerWake.of({
                wake: Queue.offer(wakeups, undefined).pipe(Effect.asVoid),
                wait: (timeout) =>
                    Queue.take(wakeups).pipe(Effect.timeoutOption(timeout), Effect.asVoid),
            });
        }),
    );
}

const time = (ms: number) =>
    new Date(ms).toLocaleString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });

/**
 * What the agent reads for an event. A terminal task stays as typed; anything else is labelled
 * with where and when it came from, so the agent can tell a timer from a chat message. The time
 * lives here rather than in the system prompt, which would otherwise change every run.
 */
export const formatItem = (item: InboxItem): string =>
    item.source === 'cli'
        ? item.prompt
        : `[${item.source} · ${time(item.createdAt)}${item.label ? ` · labelled ${item.label}` : ''}] ${item.prompt}`;

/**
 * The always-on loop. One worker drains the inbox, starting a run for every thread with pending
 * events at once and never two for one thread, so runs never compete for a session; the scheduler turns due timers into inbox events. Both are supervised:
 * a failure that keeps happening backs off instead of spinning.
 */
export class Runtime extends Context.Service<
    Runtime,
    {
        readonly bus: PubSub.PubSub<BusMessage>;
        /** The threads with a run in progress. */
        readonly running: Effect.Effect<ReadonlyArray<string>>;
    }
>()('sedge/daemon/Runtime') {
    static readonly layer = Layer.effect(
        Runtime,
        Effect.gen(function* () {
            const inbox = yield* Inbox;
            const timers = yield* Timers;
            const agent = yield* Agent;
            const worker = yield* WorkerWake;
            const connections = yield* Connections;
            const telemetry = yield* Telemetry;
            const limits = yield* Limits;
            const live = yield* LiveConfig;
            const outbox = yield* Outbox;
            const services = yield* Effect.context<never>();
            const bus = yield* PubSub.unbounded<BusMessage>();
            const running = yield* Ref.make<ReadonlySet<string>>(new Set());
            const scope = yield* Effect.scope;
            const publish = (message: BusMessage) => PubSub.publish(bus, message);

            // Dreaming: once a night the agent reads back over its recent conversations and tidies
            // its memory. `"dreaming": false` in the config turns it off.
            const { paths, config } = yield* Settings;
            const dreams = (yield* timers.list(DREAM_THREAD)).filter((t) => t.name === 'dream');
            if (config.dreaming === false) {
                for (const dream of dreams) yield* timers.cancel(dream.id);
            } else if (dreams.length === 0) {
                const cron = Cron.parse(DREAM_CRON);
                if (Result.isSuccess(cron)) {
                    yield* timers.create({
                        kind: 'schedule',
                        thread: DREAM_THREAD,
                        name: 'dream',
                        cron: DREAM_CRON,
                        prompt: DREAM_PROMPT,
                        cwd: paths.memory,
                        nextRunAt: Cron.next(cron.success, new Date()).getTime(),
                    });
                }
            }

            const recovered = yield* inbox.recoverInterrupted;
            if (recovered > 0) {
                yield* Effect.logWarning(`Requeued ${recovered} interrupted event(s)`);
            }

            /** One run: a thread's batch, from start to the outcome everyone waiting hears. */
            const process = (batch: ReadonlyArray<InboxItem>) =>
                Effect.gen(function* () {
                    const first = batch[0]!;
                    const last = batch[batch.length - 1]!;
                    const sub = subagentOf(first.thread);
                    const itemIds = batch.map((item) => item.id);
                    // Any event from outside (a signal's, or one a run woken by one passed on) makes
                    // the run untrusted: its risky tools follow permissions.signals.
                    const untrusted = batch.some((item) => item.untrusted);
                    for (const itemId of itemIds) {
                        yield* publish({
                            _tag: 'Event',
                            itemIds,
                            event: { _tag: 'Started', itemId },
                        });
                    }

                    // Events only from signals with triage on: one cheap model call decides
                    // whether they need the agent. When it can't tell, or fails, the agent wakes.
                    // Events only from signals with triage on: one cheap model call decides
                    // whether they need the agent, and labels those whose signal has labels. When it
                    // can't tell, or fails, the agent wakes.
                    let skipped: string | undefined;
                    let labelled: ReadonlyArray<InboxItem> = batch;
                    if (yield* connections.triaged(batch.map((item) => item.source))) {
                        const shapes = batch.map((item) => connections.labelsOf(item.source));
                        const verdict = yield* agent
                            .triage(
                                batch.map((item, i) => ({
                                    text: item.prompt,
                                    ...(shapes[i] ? { labels: shapes[i].labels } : {}),
                                })),
                                config.triageModel,
                            )
                            .pipe(
                                Effect.tap((verdict) =>
                                    verdict.spent ? limits.spend(verdict.spent) : Effect.void,
                                ),
                                Effect.map((verdict): Triage | undefined => verdict),
                                Effect.catch((error: AgentRunError) =>
                                    Effect.logWarning(
                                        `Triage failed, so the agent wakes: ${error.message}`,
                                    ).pipe(Effect.as(undefined)),
                                ),
                            );
                        if (verdict) {
                            const picked = verdict.labels ?? [];
                            for (const [i, item] of batch.entries()) {
                                const label = picked[i];
                                if (label) yield* inbox.setLabel(item.id, label);
                            }
                            labelled = batch.map((item, i) =>
                                picked[i] ? { ...item, label: picked[i] } : item,
                            );
                            // With wakeOn, a signal's event wakes the agent only when it's labelled one
                            // of them (or wasn't labelled at all); other events go by the model's call.
                            const ruled = batch.map((_, i) => {
                                const wakeOn = shapes[i]?.wakeOn;
                                if (!wakeOn) return undefined;
                                const label = picked[i];
                                return label === undefined || wakeOn.includes(label);
                            });
                            const byRule = ruled.some((r) => r !== undefined);
                            const wake = byRule
                                ? ruled.some((r) => r === true) ||
                                  (ruled.some((r) => r === undefined) && verdict.wake)
                                : verdict.wake;
                            if (!wake) {
                                const labels = picked.filter(Boolean).join(', ');
                                skipped = `Skipped by triage${verdict.model ? ` (${verdict.model})` : ''}: ${
                                    byRule && labels
                                        ? `labelled ${labels}, not one that wakes it`
                                        : verdict.reason
                                }`;
                            }
                        }
                    }

                    // Each tool call's timing, and what the run used, for its record.
                    const startedAt = Date.now();
                    let used: { tokens: number; cost: number } | undefined;
                    const open = new Map<string, number>();
                    const tools: Array<ToolTiming> = [];
                    const timeTools = (event: AgentEvent) => {
                        if (event._tag === 'ToolStart') open.set(event.toolCallId, Date.now());
                        if (event._tag === 'ToolEnd') {
                            const start = open.get(event.toolCallId) ?? Date.now();
                            open.delete(event.toolCallId);
                            tools.push({
                                name: event.name,
                                ms: Date.now() - start,
                                error: event.isError,
                            });
                        }
                    };
                    const outcome =
                        skipped !== undefined
                            ? { ok: true as const, text: skipped }
                            : yield* Effect.gen(function* () {
                                  // "typing…" on the user's channel while the run lasts.
                                  const typing = yield* Effect.forkChild(
                                      connections
                                          .working(first.thread)
                                          .pipe(Effect.repeat(Schedule.spaced('4 seconds'))),
                                  );
                                  return yield* agent
                                      .run(
                                          {
                                              thread: first.thread,
                                              sources: [
                                                  ...new Set(batch.map((item) => item.source)),
                                              ],
                                              cwd: last.cwd,
                                              subagent: sub !== undefined,
                                              untrusted,
                                              model: modelFor(
                                                  yield* live.current,
                                                  agentOf(first.thread),
                                                  batch.map((item) => item.source),
                                              ),
                                              onSpent: (spent) => {
                                                  used = spent;
                                                  Effect.runForkWith(services)(limits.spend(spent));
                                              },
                                              items: labelled.map((item) => ({
                                                  id: item.id,
                                                  text: formatItem(item),
                                              })),
                                          },
                                          (event) => {
                                              timeTools(event);
                                              return publish({ _tag: 'Event', itemIds, event });
                                          },
                                      )
                                      .pipe(
                                          Effect.ensuring(Fiber.interrupt(typing)),
                                          Effect.map((text) => ({ ok: true as const, text })),
                                          Effect.catch((error: AgentRunError) =>
                                              Effect.succeed({
                                                  ok: false as const,
                                                  text: error.message,
                                              }),
                                          ),
                                      );
                              });

                    // A subagent's answer goes to the agent that started it, before the run counts as
                    // done: a crash in between runs it again, and the inbox drops the second report.
                    if (sub) {
                        yield* inbox.enqueue({
                            source: `subagent:${sub.id}`,
                            externalId: `report:${last.id}`,
                            thread: sub.parent,
                            prompt: outcome.ok
                                ? `Subagent ${sub.id} answered:\n\n${outcome.text}`
                                : `Subagent ${sub.id} failed: ${outcome.text}`,
                            cwd: last.cwd,
                            untrusted,
                        });
                    }
                    yield* inbox.finish(
                        itemIds,
                        outcome.ok ? { result: outcome.text } : { error: outcome.text },
                    );
                    if (skipped === undefined)
                        yield* telemetry.recordRun({
                            id: first.id,
                            thread: first.thread,
                            sources: [...new Set(batch.map((item) => item.source))],
                            events: batch.length,
                            startedAt,
                            finishedAt: Date.now(),
                            ok: outcome.ok,
                            ...(outcome.ok ? {} : { error: outcome.text }),
                            tools,
                            ...(used ? { tokens: used.tokens, cost: used.cost } : {}),
                        });
                    if (outcome.ok) {
                        for (const itemId of itemIds) {
                            yield* publish({
                                _tag: 'Event',
                                itemIds: [itemId],
                                event: { _tag: 'Finished', itemId, text: outcome.text },
                            });
                        }
                    } else {
                        yield* publish({ _tag: 'Failed', itemIds, message: outcome.text });
                        yield* Effect.logError(`Run for ${first.thread} failed: ${outcome.text}`);
                    }
                    for (const item of batch) {
                        yield* publish({
                            _tag: 'Completed',
                            itemIds: [item.id],
                            completion: new Completion({
                                itemId: item.id,
                                source: item.source,
                                prompt: item.prompt,
                                ok: outcome.ok,
                                text: outcome.text,
                            }),
                        });
                    }
                });

            // Start a run for each thread with pending events, all at once but never two for one
            // thread; then sleep until a run ends, an event arrives, or the next poll.
            /**
             * `/model` on a channel: the model its messages run on. Alone, it shows the current one
             * and buttons for the models you're logged in to; with a name (`/model opus`), it picks
             * the one that matches, or offers the few that do. The buttons come back as
             * `/model <provider/model>`.
             */
            const modelCommand = (item: InboxItem) =>
                Effect.gen(function* () {
                    // `/model opus`, `/model opus medium` or `/model opus:medium`.
                    const words = item.prompt.replace(MODEL_COMMAND, '').trim().split(/\s+/);
                    const last = splitModel(`model:${words.at(-1) ?? ''}`).thinking;
                    const asked = (last ? words.slice(0, -1) : words).join(' ');
                    const { id: wanted, thinking: suffix } = splitModel(asked);
                    const thinking = last ?? suffix;
                    const config = yield* live.current;
                    const current =
                        config.connections?.[item.source]?.model ??
                        config.agents?.[agentOf(item.thread)]?.model ??
                        config.model;
                    const models = yield* agent.models.pipe(
                        Effect.catch(() =>
                            Effect.succeed([] as ReadonlyArray<{ id: string; name: string }>),
                        ),
                    );
                    const say = (
                        text: string,
                        choices?: ReadonlyArray<{ id: string; name: string }>,
                    ) =>
                        Effect.gen(function* () {
                            yield* outbox.enqueue({
                                thread: item.thread,
                                text,
                                ...(choices?.length
                                    ? {
                                          extra: {
                                              choices: choices.map((m) => ({
                                                  label: m.name,
                                                  value: `model:${m.id}`,
                                              })),
                                          },
                                      }
                                    : {}),
                            });
                            yield* inbox.finish([item.id], { result: text });
                        });
                    const named = wanted.toLowerCase();
                    const matches = named
                        ? models.filter(
                              (m) =>
                                  m.id.toLowerCase() === named ||
                                  m.id.toLowerCase().includes(named) ||
                                  m.name.toLowerCase().includes(named),
                          )
                        : [];
                    const exact = models.find((m) => m.id.toLowerCase() === named);
                    const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
                    // Only a level: keep the model and change how hard it thinks.
                    const keep =
                        !named && thinking && current
                            ? models.find((m) => m.id === splitModel(current).id)
                            : undefined;
                    const chosen = pick ?? keep;
                    if (chosen) {
                        const setting = thinking ? `${chosen.id}:${thinking}` : chosen.id;
                        const saved = yield* Effect.promise(() => loadConfig(paths));
                        const entry = saved.connections?.[item.source];
                        if (!entry)
                            return yield* say(`${item.source} isn't in the config any more.`);
                        yield* Effect.promise(() =>
                            saveConfig(paths, {
                                ...saved,
                                connections: {
                                    ...saved.connections,
                                    [item.source]: { ...entry, model: setting },
                                },
                            }),
                        );
                        return yield* say(
                            `Messages on ${item.source} now run on ${chosen.name} (${setting}), from the next one.`,
                        );
                    }
                    if (named && matches.length === 0) {
                        return yield* say(
                            `No model you're logged in to matches "${wanted}". Send /model to see them.`,
                        );
                    }
                    const offered = (named ? matches : models).slice(0, 12);
                    return yield* say(
                        `Messages on ${item.source} run on ${current ?? "pi's default model"}. ${
                            offered.length
                                ? 'Pick one, or send /model <name>:'
                                : 'No models are logged in.'
                        }${models.length > offered.length && !named ? ` (${models.length} in all; /model <name> narrows them.)` : ''}`,
                        offered,
                    );
                });

            const drain = Effect.gen(function* () {
                // Limits, as of this pass: events from you always go; automated ones wait while
                // today's budget is used up, or their agent has had its runs for the hour.
                const now = Date.now();
                const set = yield* limits.current;
                const budget = yield* limits.overBudget;
                const channels = new Set(
                    (yield* connections.list)
                        .filter((connection) => connection.type === 'channel')
                        .map((connection) => connection.name),
                );
                const runsThisHour = new Map<string, number>();
                const count = (thread: string) => {
                    const agent = agentOf(thread);
                    runsThisHour.set(agent, (runsThisHour.get(agent) ?? 0) + 1);
                };
                if (set.runsPerHour !== undefined) {
                    for (const run of yield* telemetry.runs({ limit: 1000 })) {
                        if (run.startedAt >= now - 3_600_000) count(run.thread);
                    }
                    for (const thread of yield* Ref.get(running)) count(thread);
                }
                const held = new Map<string, string>();
                const eligible = (item: { source: string; thread: string }) => {
                    if (fromYou(item.source, channels)) return true;
                    if (budget) {
                        held.set(
                            `budget:${dayOf(now)}`,
                            `Sedge has paused automated work: ${budget}. Events from signals, timers and agents wait until tomorrow, or until you raise \`limits\` in config.json. Your messages still get answers.`,
                        );
                        return false;
                    }
                    const agent = agentOf(item.thread);
                    if (
                        set.runsPerHour !== undefined &&
                        (runsThisHour.get(agent) ?? 0) >= set.runsPerHour
                    ) {
                        held.set(
                            `runs:${agent}:${dayOf(now)}:${new Date(now).getHours()}`,
                            `"${agent}" has had its ${set.runsPerHour} runs for this hour (\`limits.runsPerHour\`). Its events wait, and go on as the hour's runs age out. Your messages still get answers.`,
                        );
                        return false;
                    }
                    return true;
                };
                while (true) {
                    const claimed = yield* inbox.claimBatch(
                        [...(yield* Ref.get(running))],
                        eligible,
                    );
                    if (claimed.length === 0) break;
                    // `/model` from a channel is sedge's to answer, not the agent's.
                    const commands = claimed.filter(
                        (item) =>
                            channels.has(item.source) &&
                            !item.untrusted &&
                            MODEL_COMMAND.test(item.prompt),
                    );
                    for (const item of commands) yield* modelCommand(item);
                    const batch = claimed.filter((item) => !commands.includes(item));
                    const thread = batch[0]?.thread;
                    if (thread === undefined) continue;
                    count(thread);
                    yield* Ref.update(running, (set) => new Set(set).add(thread));
                    yield* process(batch).pipe(
                        Effect.catchCause((cause) =>
                            Effect.logError(`Run for ${thread} crashed`, cause),
                        ),
                        Effect.ensuring(
                            Ref.update(running, (set) => {
                                const next = new Set(set);
                                next.delete(thread);
                                return next;
                            }).pipe(Effect.andThen(worker.wake)),
                        ),
                        Effect.forkIn(scope),
                    );
                }
                for (const [key, text] of held) yield* limits.notify(key, text);
                yield* worker.wait('5 seconds');
            });

            const tick = Effect.gen(function* () {
                const now = Date.now();
                for (const timer of yield* timers.due(now)) {
                    let next: number | undefined;
                    if (timer.kind === 'schedule') {
                        const cron = Cron.parse(timer.cron ?? '');
                        if (Result.isFailure(cron)) {
                            yield* Effect.logError(
                                `Timer ${timer.id} has an invalid cron: ${timer.cron}`,
                            );
                            yield* timers.cancel(timer.id);
                            continue;
                        }
                        next = Cron.next(cron.success, new Date(now)).getTime();
                    }
                    // The firing's due time makes the event id: a crash before markFired fires
                    // the timer again, and the inbox drops the duplicate.
                    yield* inbox.enqueue({
                        source: 'timer',
                        externalId: `${timer.id}@${timer.nextRunAt}`,
                        thread: timer.thread,
                        prompt: timer.name ? `${timer.name}: ${timer.prompt}` : timer.prompt,
                        cwd: timer.cwd,
                        untrusted: timer.untrusted,
                    });
                    yield* timers.markFired(timer, now, next);
                }
                yield* worker.wake;
                yield* Effect.sleep('15 seconds');
            });

            yield* Effect.forkScoped(supervise('Inbox worker', drain));
            yield* Effect.forkScoped(supervise('Scheduler', tick));

            return Runtime.of({
                bus,
                running: Ref.get(running).pipe(Effect.map((set) => [...set])),
            });
        }),
    );
}

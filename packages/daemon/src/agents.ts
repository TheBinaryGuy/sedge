import { type AgentEntry, loadConfig, saveConfig } from '@sedge-hq/core';
import { Inbox, Timers } from '@sedge-hq/db';
import { Context, Effect, Layer } from 'effect';
import { Connections } from './connections';
import { ensureMemory } from './memory';
import { WorkerWake } from './runtime';
import { Settings } from './settings';
import { agentOf, MAIN, memoryOf, threadOf } from './threads';

export { agentOf, MAIN, memoryOf, threadOf } from './threads';

const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export interface AgentView {
    readonly name: string;
    readonly purpose: string;
    readonly workspace: string;
    readonly memory: string;
    /** The channels and signals it handles. */
    readonly connections: ReadonlyArray<string>;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Agents: named workers besides `main`, each with its own durable conversation, memory folder and
 * purpose, handling the channels and signals given to it. They talk to each other through the
 * inbox: `tell` puts a message in the other's queue, and the answer comes back the same way.
 */
export class Agents extends Context.Service<
    Agents,
    {
        readonly list: Effect.Effect<ReadonlyArray<AgentView>>;
        readonly get: (name: string) => Effect.Effect<AgentView | undefined>;
        /** Creates an agent, or changes one; `connections` are given to it (others keep theirs). */
        readonly save: (input: {
            readonly name: string;
            readonly purpose: string;
            readonly connections?: ReadonlyArray<string> | undefined;
        }) => Effect.Effect<AgentView, Error>;
        /** Removes an agent: its channels and signals go back to `main`, its timers stop. */
        readonly remove: (name: string) => Effect.Effect<void, Error>;
        /** A message from one agent (by thread) into another's inbox. */
        readonly tell: (fromThread: string, to: string, message: string) => Effect.Effect<string>;
    }
>()('sedge/daemon/Agents') {
    static readonly layer = Layer.effect(
        Agents,
        Effect.gen(function* () {
            const { paths, workspace } = yield* Settings;
            const connections = yield* Connections;
            const inbox = yield* Inbox;
            const timers = yield* Timers;
            const worker = yield* WorkerWake;

            const config = Effect.promise(() => loadConfig(paths));

            const view = (
                name: string,
                entry: AgentEntry,
                owned: Readonly<Record<string, { readonly agent?: string | undefined }>>,
            ): AgentView => ({
                name,
                purpose: entry.purpose,
                workspace,
                memory: memoryOf(paths, name),
                connections: Object.entries(owned)
                    .filter(([, c]) => (c.agent ?? MAIN) === name)
                    .map(([connection]) => connection),
            });

            const all = Effect.gen(function* () {
                const current = yield* config;
                const owned = current.connections ?? {};
                const main: AgentEntry = {
                    purpose:
                        'sedge itself: talks with the user, and handles whatever no other agent does.',
                };
                return [
                    view(MAIN, main, owned),
                    ...Object.entries(current.agents ?? {}).map(([name, entry]) =>
                        view(name, entry, owned),
                    ),
                ];
            });

            // Every agent's memory folder exists, so it can read and write it from its first run.
            for (const agent of yield* all) {
                yield* Effect.promise(() => ensureMemory(agent.memory));
            }

            const get = (name: string) =>
                all.pipe(Effect.map((agents) => agents.find((agent) => agent.name === name)));

            const save = Effect.fn('Agents.save')(function* (input: {
                readonly name: string;
                readonly purpose: string;
                readonly connections?: ReadonlyArray<string> | undefined;
            }) {
                if (input.name === MAIN) {
                    return yield* Effect.fail(
                        new Error('main is sedge itself; its purpose is fixed.'),
                    );
                }
                if (!NAME.test(input.name)) {
                    return yield* Effect.fail(
                        new Error(
                            'Names are lowercase letters, digits and dashes, starting with a letter.',
                        ),
                    );
                }
                if (!input.purpose.trim()) {
                    return yield* Effect.fail(new Error('Say what the agent is for.'));
                }
                const current = yield* config;
                for (const connection of input.connections ?? []) {
                    if (!current.connections?.[connection]) {
                        return yield* Effect.fail(
                            new Error(`Nothing is connected as "${connection}".`),
                        );
                    }
                }
                yield* Effect.tryPromise({
                    try: () =>
                        saveConfig(paths, {
                            ...current,
                            agents: {
                                ...current.agents,
                                [input.name]: { purpose: input.purpose.trim() },
                            },
                        }),
                    catch: (error) => new Error(describe(error)),
                });
                for (const connection of input.connections ?? []) {
                    yield* connections.assign(connection, input.name);
                }
                yield* Effect.promise(() => ensureMemory(memoryOf(paths, input.name)));
                return (yield* get(input.name))!;
            });

            const remove = Effect.fn('Agents.remove')(function* (name: string) {
                if (name === MAIN) return yield* Effect.fail(new Error('main is sedge itself.'));
                const current = yield* config;
                if (!current.agents?.[name]) {
                    return yield* Effect.fail(new Error(`There is no agent "${name}".`));
                }
                const { [name]: _, ...rest } = current.agents;
                yield* Effect.tryPromise({
                    try: () => saveConfig(paths, { ...current, agents: rest }),
                    catch: (error) => new Error(describe(error)),
                });
                for (const [connection, entry] of Object.entries(current.connections ?? {})) {
                    if (entry.agent === name) yield* connections.assign(connection, MAIN);
                }
                for (const timer of yield* timers.list(threadOf(name)))
                    yield* timers.cancel(timer.id);
            });

            const tell = Effect.fn('Agents.tell')(function* (
                fromThread: string,
                to: string,
                message: string,
            ) {
                const from = agentOf(fromThread);
                const target = yield* get(to);
                if (!target) {
                    const names = (yield* all).map((agent) => agent.name).join(', ');
                    return `There is no agent "${to}". The agents are: ${names}.`;
                }
                if (target.name === from) return 'That is you.';
                yield* inbox.enqueue({
                    source: `agent:${from}`,
                    thread: threadOf(target.name),
                    prompt: `Message from the agent "${from}" (answer with tell, agent "${from}"):\n\n${message}`,
                    cwd: target.workspace,
                });
                yield* worker.wake;
                return `Sent to ${target.name}. Its answer arrives as a new event; end your turn unless you have more to do now.`;
            });

            return Agents.of({ list: all, get, save, remove, tell });
        }),
    );
}

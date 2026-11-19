import type * as PiModule from '@earendil-works/pi-coding-agent';
import type { Models } from '@earendil-works/pi-ai';
import { AgentRunError, type AgentEvent } from '@sedge-hq/protocol';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { join } from 'node:path';
import type { Durable, Item, ModelChoice } from './durable';
import type { AgentHost, RunContext } from './host';

export type { AgentHost, Outgoing, RunContext, TimerSpec, ToolDecision } from './host';
export type { Item, ModelChoice } from './durable';

type Pi = typeof PiModule;

export interface AgentConfig {
    /** pi's agent directory (auth.json, models.json, settings); pi's own default when unset. */
    readonly agentDir?: string | undefined;
    /** The durable store: conversations, runs and tool calls. */
    readonly file: string;
    /** Where runs work when nothing says otherwise. */
    readonly workspace: string;
    /**
     * Loads pi on the first run rather than at startup, so the daemon's socket is up in a fraction
     * of the time. The CLI passes one that runs pi's Bun setup first.
     */
    readonly loadPi: () => Promise<Pi>;
    /** Memory, outbox, timers and permissions, provided by the daemon. */
    readonly host: AgentHost;
    /** Models and the model choice, for tests; pi's logins and default model otherwise. */
    readonly models?: () => Promise<{
        readonly models: Models;
        readonly choose: (cwd: string) => Promise<ModelChoice | undefined>;
    }>;
}

export const defaultAgentConfig = (
    home: string,
    workspace: string,
    host: AgentHost,
    loadPi: () => Promise<Pi> = () => import('@earendil-works/pi-coding-agent'),
): AgentConfig => ({
    agentDir: process.env.SEDGE_AGENT_DIR,
    file: join(home, 'agent', 'durable.sqlite'),
    workspace,
    loadPi,
    host,
});

export interface RunInput extends RunContext {
    /** Inbox items, each submitted with its id so a repeat after a restart is answered once. */
    readonly items: ReadonlyArray<Item>;
}

/**
 * Your pi logins (auth.json, OAuth subscriptions) and models.json, and the default model and
 * thinking level from pi's settings, read fresh for every run so a change in `sedge` applies.
 */
const piModels = async (config: AgentConfig) => {
    const pi = await config.loadPi();
    const agentDir = config.agentDir ?? pi.getAgentDir();
    const models = await pi.ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: join(agentDir, 'models.json'),
    });
    const choose = async (cwd: string): Promise<ModelChoice | undefined> => {
        const settings = pi.SettingsManager.create(cwd, agentDir);
        const provider = settings.getDefaultProvider();
        const modelId = settings.getDefaultModel();
        const thinkingLevel = settings.getDefaultThinkingLevel();
        const level = thinkingLevel ? { thinkingLevel } : {};
        if (provider && modelId && models.getModel(provider, modelId)) {
            return { provider, modelId, ...level };
        }
        const [first] = await models.getAvailable();
        return first ? { provider: first.provider, modelId: first.id, ...level } : undefined;
    };
    return { models: models as unknown as Models, choose };
};

/**
 * The daemon's agent: pi-durable does the reasoning and keeps every conversation (one per thread)
 * in SQLite, so runs survive restarts. Runs are serialized: the daemon's worker already sends one
 * at a time, the lock makes that a guarantee rather than a convention.
 */
export class Agent extends Context.Service<
    Agent,
    {
        readonly run: (
            input: RunInput,
            onEvent: (event: AgentEvent) => Effect.Effect<void>,
        ) => Effect.Effect<string, AgentRunError>;
        readonly abort: Effect.Effect<void>;
    }
>()('sedge/agent/Agent') {
    static readonly layer = (config: AgentConfig) =>
        Layer.effect(
            Agent,
            Effect.gen(function* () {
                const lock = yield* Semaphore.make(1);
                let opening: Promise<Durable> | undefined;
                const open = () =>
                    (opening ??= (async () => {
                        const { openDurable } = await import('./durable');
                        const { models, choose } = await (
                            config.models ?? (() => piModels(config))
                        )();
                        return openDurable({
                            file: config.file,
                            workspace: config.workspace,
                            models,
                            model: choose,
                            host: config.host,
                            report: (message) => console.error(`[agent] ${message}`),
                        });
                    })().catch((error: unknown) => {
                        opening = undefined;
                        throw error;
                    }));

                // Opened in the background at startup, so a run a restart interrupted resumes
                // without waiting for the next event.
                yield* Effect.forkScoped(
                    Effect.tryPromise(open).pipe(
                        Effect.catch((error) =>
                            Effect.logWarning(`Agent not ready: ${describe(error)}`),
                        ),
                    ),
                );
                yield* Effect.addFinalizer(() =>
                    Effect.promise(async () => {
                        const durable = await opening?.catch(() => undefined);
                        await durable?.close().catch(() => undefined);
                    }),
                );

                const run = Effect.fn('Agent.run')(function* (
                    input: RunInput,
                    onEvent: (event: AgentEvent) => Effect.Effect<void>,
                ) {
                    const services = yield* Effect.context<never>();
                    const emit = (event: AgentEvent) => {
                        Effect.runForkWith(services)(onEvent(event));
                    };
                    return yield* Effect.tryPromise({
                        try: async () => (await open()).run(input, emit),
                        catch: (cause) => new AgentRunError({ message: describe(cause) }),
                    });
                }, lock.withPermits(1));

                const abort = Effect.promise(async () => {
                    const durable = await opening?.catch(() => undefined);
                    await durable?.abort();
                });

                return Agent.of({ run, abort });
            }),
        );
}

const describe = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause);

import type * as PiModule from '@earendil-works/pi-coding-agent';
import { defineExtension, defineTool, hook, ToolTask } from '@earendil-works/pi-durable';
import { basename, dirname, extname } from 'node:path';

type Pi = typeof PiModule;
type ModelRuntime = Awaited<ReturnType<Pi['ModelRuntime']['create']>>;
type LoadedExtension = ReturnType<
    InstanceType<Pi['DefaultResourceLoader']>['getExtensions']
>['extensions'][number];

/** Tools the daemon has already: an extension's tool by one of these names isn't loaded. */
const TAKEN = new Set([
    'read',
    'write',
    'edit',
    'bash',
    'powershell',
    'ls',
    'find',
    'grep',
    'recall',
    'tool_search',
    'send_message',
    'tell',
    'subagent',
    'get_state',
    'set_state',
    'set_timer',
    'list_timers',
    'cancel_timer',
]);

/** What an extension is called in `piExtensions`: its file's name (`foo` for foo.ts or foo/index.ts). */
export const extensionName = (extension: { path: string }) => {
    const file = basename(extension.path, extname(extension.path));
    return file === 'index' ? basename(dirname(extension.path)) : file;
};

const refuse = (what: string) => () => {
    throw new Error(`${what} isn't available in sedge's daemon, where nobody is watching.`);
};

/**
 * pi extensions in the daemon's runs: only the ones listed, by name or by the package they came
 * in (`npm:pi-foo`). Their tools become the agent's tools, their `tool_call` handlers see (and can
 * block) every tool call, and their model providers join the daemon's models. What needs a person
 * (UI, commands, sending messages, switching models) isn't there: dialogs answer no, and those
 * calls fail.
 */
export const loadPiExtensions = async (options: {
    readonly pi: Pi;
    readonly agentDir: string;
    readonly cwd: string;
    readonly names: ReadonlyArray<string>;
    readonly modelRuntime: ModelRuntime;
    readonly report: (message: string) => void;
}) => {
    const { pi, agentDir, cwd, names, modelRuntime, report } = options;
    const settingsManager = pi.SettingsManager.create(cwd, agentDir);
    const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager });
    // A repository's own extensions never load unattended: nobody is there to trust it.
    await loader.reload({ resolveProjectTrust: () => false } as never);
    const loaded = loader.getExtensions();
    for (const { path, error } of loaded.errors) report(`pi extension ${path}: ${error}`);

    const wanted = new Set(names);
    const chosen = loaded.extensions.filter(
        (extension: LoadedExtension) =>
            wanted.has(extensionName(extension)) || wanted.has(extension.sourceInfo.source),
    );
    const found = new Set(
        chosen.flatMap((extension: LoadedExtension) => [
            extensionName(extension),
            extension.sourceInfo.source,
        ]),
    );
    for (const name of names) {
        if (!found.has(name)) report(`pi extension "${name}" isn't installed; it's left out`);
    }
    if (chosen.length === 0) return undefined;

    const { runtime } = loaded;
    const runner = new pi.ExtensionRunner(
        chosen,
        runtime,
        cwd,
        pi.SessionManager.inMemory(),
        new pi.ModelRegistry(modelRuntime),
    );
    const actions = new Proxy(
        {
            getActiveTools: () => [],
            getAllTools: () => [],
            getCommands: () => [],
            getSessionName: () => undefined,
            getThinkingLevel: () => 'medium',
            getSettings: () => ({}),
        } as Record<string, unknown>,
        { get: (target, key: string) => target[key] ?? refuse(key) },
    );
    runner.bindCore(
        actions as never,
        {
            getModel: () => undefined,
            getScopedModels: () => [],
            isIdle: () => true,
            isProjectTrusted: () => false,
            getSignal: () => undefined,
            abort: () => {},
            hasPendingMessages: () => false,
            shutdown: () => {},
            getContextUsage: () => undefined,
            compact: refuse('compact'),
            getSystemPrompt: () => '',
            executeTool: refuse('Calling another tool from an extension'),
            getCallableTools: () => [],
        } as never,
        {
            registerProvider: (name, config) => modelRuntime.registerProvider(name, config),
            registerNativeProvider: (provider) => modelRuntime.registerNativeProvider(provider),
            unregisterProvider: (name) => modelRuntime.unregisterProvider(name),
            registerVirtualModel: (definition) => modelRuntime.registerVirtualModel(definition),
            unregisterVirtualModel: (provider, id) =>
                modelRuntime.unregisterVirtualModel(provider, id),
        },
    );
    for (const { provider } of runtime.pendingNativeProviderRegistrations ?? []) {
        try {
            modelRuntime.registerNativeProvider(provider);
        } catch (error) {
            report(
                `pi extension provider: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
    runtime.pendingNativeProviderRegistrations = [];
    runner.onError((error) => report(`pi extension ${error.extensionPath}: ${error.error}`));

    const tools = runner.getAllRegisteredTools().flatMap((registered) => {
        const tool = pi.wrapRegisteredTool(registered, runner);
        if (TAKEN.has(tool.name)) {
            report(
                `pi extension tool "${tool.name}" has the name of one of sedge's; it's left out`,
            );
            return [];
        }
        return [
            defineTool({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as never,
                // Whether it's safe to run twice isn't known: after a crash mid-call, the model gets an
                // "interrupted" result instead of a second run.
                replay: 'unsafe',
                execute: async (args, api, context) => {
                    const result = await tool.execute(
                        api.callId,
                        args as never,
                        (context as { abortSignal?: AbortSignal }).abortSignal,
                    );
                    return {
                        output: result.content as never,
                        ...(result.isError ? { isError: true } : {}),
                    };
                },
            }),
        ];
    });

    const extension = defineExtension({
        name: 'pi-extensions',
        tools,
        hooks: runner.hasHandlers('tool_call')
            ? [
                  hook(ToolTask, {
                      beforeTool: async (call) => {
                          const input = structuredClone(call.arguments) as Record<string, unknown>;
                          const before = JSON.stringify(input);
                          const result = await runner.emitToolCall({
                              type: 'tool_call',
                              toolCallId: call.id,
                              toolName: call.name,
                              input,
                          } as never);
                          if (result?.block) {
                              return { block: result.reason ?? 'An extension blocked this call.' };
                          }
                          // Handlers change a call's arguments by changing its input in place.
                          return JSON.stringify(input) === before
                              ? undefined
                              : { arguments: input as never };
                      },
                  }),
              ]
            : [],
    });

    return {
        extension,
        names: chosen.map(extensionName),
        start: () => runner.emit({ type: 'session_start', reason: 'startup' } as never),
        close: () => runner.emit({ type: 'session_shutdown' } as never),
    };
};

export type PiExtensions = NonNullable<Awaited<ReturnType<typeof loadPiExtensions>>>;

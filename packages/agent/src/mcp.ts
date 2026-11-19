import { defineExtension, defineTool, type ToolRegistration } from '@earendil-works/pi-durable';
import {
    createMcpToolName,
    limitMcpContent,
    McpClient,
    normalizeMcpInputSchema,
    StdioTransport,
    StreamableHttpTransport,
    toLlmContent,
    validateMcpServerConfig,
} from '@earendil-works/pi-mcp';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The MCP servers in your `mcp.json` (pi's, in its agent directory), for the daemon's runs. Every
 * tool is deferred: the agent finds one with `tool_search` when it needs it, so a large set costs
 * nothing until then. Only the global file is read: a repository can't add servers to runs
 * nobody watches. Servers that sign in through OAuth stay in the TUI for now.
 */

type Exposure = 'codemode' | 'deferred' | 'direct' | 'hidden';
interface ServerConfig {
    readonly enabled?: boolean;
    readonly timeout?: number;
    readonly exposure?: Exposure;
    readonly toolExposure?: Record<string, Exposure>;
    // stdio
    readonly command?: string;
    readonly args?: Array<string>;
    readonly env?: Record<string, string>;
    readonly cwd?: string;
    // http
    readonly url?: string;
    readonly headers?: Record<string, string>;
    readonly oauth?: unknown;
    readonly auth?: unknown;
}

export interface McpServerState {
    readonly name: string;
    /** `ready (n tools)`, why it isn't, or `off`. */
    readonly status: string;
}

const expandHome = (value: string) =>
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;

/**
 * pi's config values: `$NAME` and `${NAME}` read the environment (`$$` is a dollar sign), and a
 * value starting with `!` is a shell command whose output is the value (`!op read …`).
 */
export const resolveValue = async (value: string): Promise<string> => {
    if (value.startsWith('!')) {
        const proc = Bun.spawn(['sh', '-c', value.slice(1)], { stdout: 'pipe', stderr: 'pipe' });
        const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
        if (code !== 0) throw new Error(`the command for a value failed: ${value.slice(1)}`);
        return out.trim();
    }
    return value.replace(/\$(\$|!|\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g, (_, all, braced, bare) => {
        if (all === '$' || all === '!') return all;
        const name = braced ?? bare;
        const found = process.env[name];
        if (found === undefined) throw new Error(`the environment variable ${name} is not set`);
        return found;
    });
};

const resolveAll = async (values: Record<string, string> | undefined) =>
    Object.fromEntries(
        await Promise.all(
            Object.entries(values ?? {}).map(async ([key, value]) => [
                key,
                await resolveValue(value),
            ]),
        ),
    ) as Record<string, string>;

const exposureOf = (config: ServerConfig, tool: string): Exposure => {
    const overrides = config.toolExposure ?? {};
    if (overrides[tool]) return overrides[tool];
    for (const [pattern, exposure] of Object.entries(overrides)) {
        if (!pattern.includes('*')) continue;
        const regex = new RegExp(
            `^${pattern
                .split('*')
                .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
                .join('.*')}$`,
        );
        if (regex.test(tool)) return exposure;
    }
    return config.exposure ?? 'codemode';
};

export const openMcp = async (options: {
    /** The mcp.json to read. */
    readonly file: string;
    /** Where stdio servers start, unless their config says. */
    readonly cwd: string;
    readonly version: string;
}) => {
    const raw: { mcpServers?: Record<string, unknown> } = await readFile(options.file, 'utf8').then(
        (text) => JSON.parse(text) as { mcpServers?: Record<string, unknown> },
        (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return {};
            throw error;
        },
    );
    const states: Array<McpServerState> = [];
    const tools: Array<ToolRegistration> = [];
    const clients: Array<McpClient> = [];
    const taken = new Set<string>();

    const connect = async (name: string, value: unknown) => {
        const checked = validateMcpServerConfig(name, value);
        if (checked.kind === 'invalid') return states.push({ name, status: checked.error });
        const config = checked.config as ServerConfig;
        if (config.enabled === false) return states.push({ name, status: 'off' });
        if (
            config.url &&
            (config.oauth ||
                config.auth ||
                !Object.keys(config.headers ?? {}).some((h) => h.toLowerCase() === 'authorization'))
        ) {
            return states.push({ name, status: 'signs in with OAuth: only in the TUI for now' });
        }
        try {
            const transport = config.url
                ? new StreamableHttpTransport({
                      url: config.url,
                      headers: await resolveAll(config.headers),
                  })
                : new StdioTransport({
                      command: expandHome(config.command!),
                      args: config.args?.map(expandHome),
                      cwd: resolve(options.cwd, expandHome(config.cwd ?? '.')),
                      env: await resolveAll(config.env),
                      stderr: 'pipe',
                  });
            const client = new McpClient({
                name: 'sedge',
                version: options.version,
                requestTimeoutMs: (config.timeout ?? 60) * 1000,
            });
            await client.connect(transport);
            clients.push(client);
            let count = 0;
            for (const tool of await client.listTools()) {
                const exposure = exposureOf(config, tool.name);
                if (exposure === 'hidden') continue;
                const toolName = createMcpToolName(name, tool.name, (n) => taken.has(n));
                taken.add(toolName);
                count++;
                tools.push(
                    defineTool({
                        name: toolName,
                        description: `${tool.description ?? tool.name} (MCP server "${name}")`,
                        parameters: normalizeMcpInputSchema(
                            (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
                        ),
                        ...(exposure === 'direct' ? {} : { deferred: true as const }),
                        execute: async (args) => {
                            const result = await client.callTool(
                                tool.name,
                                args as Record<string, unknown>,
                            );
                            const { content } = await limitMcpContent(toLlmContent(result));
                            return {
                                output: content,
                                ...(result.isError ? { isError: true } : {}),
                            };
                        },
                    }),
                );
            }
            states.push({ name, status: `ready (${count} tools)` });
        } catch (error) {
            states.push({
                name,
                status: `failed: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
        return undefined;
    };

    // One at a time: tool names must come out the same on every start.
    for (const [name, value] of Object.entries(raw.mcpServers ?? {})) await connect(name, value);

    return {
        extension: defineExtension({ name: 'mcp', tools }),
        states,
        close: async () => {
            await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
        },
    };
};

/** The run the agent is in: which conversation, what woke it, where it works. */
export interface RunContext {
    readonly thread: string;
    /** What the events in this run came from (`telegram`, `timer`, `approval`, `cli`, a signal). */
    readonly sources: ReadonlyArray<string>;
    readonly cwd: string;
}

export interface TimerSpec {
    readonly prompt: string;
    /** A delay such as `30m`, `2h`, `1d` (a follow-up). */
    readonly in?: string | undefined;
    /** An ISO date-time (a follow-up). */
    readonly at?: string | undefined;
    /** Five-field cron, in the machine's time zone (a recurring schedule). */
    readonly cron?: string | undefined;
    readonly name?: string | undefined;
}

/** What the agent sends the user: Markdown text, buttons to pick from, files to attach. */
export interface Outgoing {
    readonly text: string;
    readonly choices?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    readonly files?: ReadonlyArray<{ readonly path: string; readonly caption?: string }>;
}

export type ToolDecision =
    | { readonly allow: true }
    | { readonly allow: false; readonly reason: string };

/**
 * What the daemon gives the agent: memory, the outbox, timers and the permission policy. The agent
 * package stays free of storage; the daemon implements this over its stores.
 */
export interface AgentHost {
    /** Sedge's part of the system prompt: memory and how to behave. Re-read before each request. */
    readonly systemPrompt: (run: RunContext) => Promise<string>;
    readonly send: (run: RunContext, message: Outgoing) => Promise<string>;
    /** Puts a message in another agent's inbox; its answer comes back the same way. */
    readonly tell: (run: RunContext, agent: string, message: string) => Promise<string>;
    readonly setTimer: (run: RunContext, spec: TimerSpec) => Promise<string>;
    readonly listTimers: (run: RunContext) => Promise<string>;
    readonly cancelTimer: (run: RunContext, id: string) => Promise<boolean>;
    readonly checkTool: (
        run: RunContext,
        toolName: string,
        input: Record<string, unknown>,
    ) => Promise<ToolDecision>;
}

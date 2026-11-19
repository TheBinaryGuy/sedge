/** The run the agent is in: which conversation, what woke it, where it works. */
export interface RunContext {
    readonly thread: string;
    /** Sources of the events in this run (`telegram`, `timer`, `approval`, `cli`). */
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

export type ToolDecision =
    | { readonly allow: true }
    | { readonly allow: false; readonly reason: string; readonly endRun?: boolean };

/**
 * What the daemon gives the agent: memory, the outbox, timers and the permission policy. The agent
 * package stays free of storage; the daemon implements this over its stores.
 */
export interface AgentHost {
    /** Appended to pi's system prompt at the start of every run: memory and recent messages. */
    readonly systemPrompt: (run: RunContext) => Promise<string>;
    readonly send: (run: RunContext, text: string) => Promise<void>;
    readonly setTimer: (run: RunContext, spec: TimerSpec) => Promise<string>;
    readonly listTimers: (run: RunContext) => Promise<string>;
    readonly cancelTimer: (run: RunContext, id: string) => Promise<boolean>;
    readonly checkTool: (
        run: RunContext,
        toolName: string,
        input: Record<string, unknown>,
    ) => Promise<ToolDecision>;
}

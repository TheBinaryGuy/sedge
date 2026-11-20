import type { SedgePaths } from '@sedge-hq/core';
import { join } from 'node:path';

/** sedge itself: the agent you talk to unless a channel belongs to another. */
export const MAIN = 'main';

/** An agent's conversation. `main` keeps its old name, `main`; the others are `agent:<name>`. */
export const threadOf = (agent: string) => (agent === MAIN ? MAIN : `agent:${agent}`);

const SUBAGENT = '#sub:';

/** A subagent's conversation: its parent's thread with the subagent's id after it. */
export const subagentThread = (parent: string, id: string) => `${parent}${SUBAGENT}${id}`;

/** The thread that started a subagent, and the subagent's id; `undefined` for any other thread. */
export const subagentOf = (thread: string) => {
    const at = thread.lastIndexOf(SUBAGENT);
    return at < 0
        ? undefined
        : { parent: thread.slice(0, at), id: thread.slice(at + SUBAGENT.length) };
};

/**
 * The agent a thread belongs to; a subagent belongs to the agent that started it. Terminal tasks
 * (`cli:…`) and dreaming are sedge's own, so `main`.
 */
export const agentOf = (thread: string): string => {
    const sub = subagentOf(thread);
    if (sub) return agentOf(sub.parent);
    return thread.startsWith('agent:') ? thread.slice(6) : MAIN;
};

/** Each agent's memory folder: `main`'s is the memory folder itself, the others' are inside it. */
export const memoryOf = (paths: SedgePaths, agent: string) =>
    agent === MAIN ? paths.memory : join(paths.memory, 'agents', agent);

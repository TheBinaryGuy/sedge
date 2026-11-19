import type { SedgePaths } from '@sedge-hq/core';
import { join } from 'node:path';

/** sedge itself: the agent you talk to unless a channel belongs to another. */
export const MAIN = 'main';

/** An agent's conversation. `main` keeps its old name, `main`; the others are `agent:<name>`. */
export const threadOf = (agent: string) => (agent === MAIN ? MAIN : `agent:${agent}`);

/**
 * The agent a thread belongs to. Terminal tasks (`cli:…`) and dreaming are sedge's own, so `main`.
 */
export const agentOf = (thread: string) => (thread.startsWith('agent:') ? thread.slice(6) : MAIN);

/** Each agent's memory folder: `main`'s is the memory folder itself, the others' are inside it. */
export const memoryOf = (paths: SedgePaths, agent: string) =>
    agent === MAIN ? paths.memory : join(paths.memory, 'agents', agent);

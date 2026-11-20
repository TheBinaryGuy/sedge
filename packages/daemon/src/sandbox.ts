import { type Sandbox, sandboxPolicy } from '@sedge-hq/agent';
import type { SedgeConfig, SedgePaths } from '@sedge-hq/core';

/**
 * The sandbox from config.json, or `undefined` when it's off. Besides what the user lists, runs may
 * write to the workspace and memory, and nothing in it may read sedge's config or secrets.
 */
export const sedgeSandbox = (
    paths: SedgePaths,
    config: SedgeConfig,
    workspace: string,
): Sandbox | undefined =>
    config.sandbox?.enabled
        ? sandboxPolicy(config.sandbox, {
              writable: [workspace, paths.memory],
              hidden: [paths.config, paths.secrets],
          })
        : undefined;

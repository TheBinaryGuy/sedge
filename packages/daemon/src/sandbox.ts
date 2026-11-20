import { type Sandbox, sandboxPolicy } from '@sedge-hq/agent';
import type { SedgeConfig, SedgePaths } from '@sedge-hq/core';
import { join } from 'node:path';

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
              // pi's logins and MCP sign-ins, wherever SEDGE_AGENT_DIR puts them.
              hidden: [
                  paths.config,
                  paths.secrets,
                  ...(process.env.SEDGE_AGENT_DIR
                      ? [
                            join(process.env.SEDGE_AGENT_DIR, 'auth.json'),
                            join(process.env.SEDGE_AGENT_DIR, 'mcp-auth.json'),
                        ]
                      : []),
              ],
          })
        : undefined;

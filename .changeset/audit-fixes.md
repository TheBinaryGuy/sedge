---
'@sedge-hq/sedge': patch
---

`sedge install <name>` scopes only the official names (telegram, slack, github, web, local, mqtt)
to `@sedge-hq`; any other name installs as written. Filtering `sedge dash` by agent includes its
subagents' events and runs. The sandbox also hides MCP sign-ins, `~/.npmrc` and git credentials,
and the pi logins in `SEDGE_AGENT_DIR` when it's set. The TUI's agent knows about limits, the
sandbox and subagents.

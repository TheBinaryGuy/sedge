---
title: MCP and skills
description: Using your MCP servers and skills in the daemon's runs, not only in the TUI.
---

## In the TUI

The TUI is pi, so MCP servers and skills work exactly as in pi: manage them with `/mcp`, or
`sedge pi mcp …` and `sedge pi config`.

## In the daemon's runs

Runs that happen without you (Telegram, signals, timers) get them too.

### MCP servers

The daemon reads the same global `mcp.json` as pi (`~/.pi/agent/mcp.json`), with the same format:

```json
{
    "mcpServers": {
        "github": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
        },
        "docs": {
            "url": "https://example.com/mcp",
            "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
        }
    }
}
```

- `${NAME}` and `$NAME` read the environment; a value starting with `!` is a shell command whose
  output is used (`"!op read op://vault/github/token"`).
- `"enabled": false` skips a server. `exposure` / `toolExposure` set to `"hidden"` hide tools.
- Tools are found on demand: the agent searches with `tool_search` and only then sees a tool's
  schema, so many servers cost nothing until used.
- In runs you're not watching, MCP calls ask for approval first, like shell commands (see
  [Security](./security.md)).
- Servers start with the daemon. After changing `mcp.json`, restart it:
  `sedge stop && sedge start`.

Not yet in the daemon:

- **Project files** (`.pi/mcp.json` in a repository) are ignored, so a repository can't add tools
  to runs nobody watches.
- **Servers that sign in with OAuth**, and servers that use a `/login` provider (`"auth"`), only
  work in the TUI for now. Give an HTTP server an `Authorization` header to use it in the daemon.

### Skills

The daemon lists your skills the way pi does (from `~/.pi/agent/skills` and the folders pi reads)
in its system prompt, and the agent reads one with its `read` tool when a task calls for it.
Skills marked `disable-model-invocation` are left out.

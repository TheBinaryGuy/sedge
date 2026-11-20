---
title: Extensions, MCP and skills
description: Your pi extensions, MCP servers and skills, and which of them the daemon's runs get.
---

Three ways to give the agent more to work with, and where each one works:

|               | The TUI | The daemon's runs                    |
| ------------- | ------- | ------------------------------------ |
| pi extensions | Yes     | Not yet: see [below](#pi-extensions) |
| MCP servers   | Yes     | Yes, from your global `mcp.json`     |
| Skills        | Yes     | Yes                                  |

## In the TUI

The TUI is pi, so extensions, MCP servers and skills work exactly as in pi: install packages with
`sedge pi install …`, manage MCP servers with `/mcp` or `sedge pi mcp …`, and settings with
`sedge pi config`.

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
  schema, so many servers cost nothing until used. Set `exposure` to `"direct"` for a server
  whose tools should be offered up front.
- In runs you're not watching, MCP calls ask for approval first, like shell commands (see
  [Security](./security.md)).
- Servers start with the daemon. After changing `mcp.json`, restart it:
  `sedge stop && sedge start`.

Not yet in the daemon:

- **Project files** (`.pi/mcp.json` in a repository) are ignored, so a repository can't add tools
  to runs nobody watches.
- **Servers that use a `/login` provider's token** (`"auth"`) only work in the TUI for now.

Servers that **sign in with OAuth** work in the daemon once you've signed in from the TUI: run
`/mcp` in `sedge`, sign in, then restart the daemon (`sedge stop && sedge start`). The daemon uses
the same sign-in and refreshes it the way pi does, without the two ever refreshing at once. If a
sign-in expires, the server's status says so; sign in again from the TUI.

### Skills

The daemon lists your skills the way pi does (from `~/.pi/agent/skills` and the folders pi reads)
in its system prompt, and the agent reads one with its `read` tool when a task calls for it.
Skills marked `disable-model-invocation` are left out.

## pi extensions

pi extensions (from `~/.pi/agent/extensions`, the packages you installed with `sedge pi install`,
or a project's `.pi/extensions`) load in the TUI, as in pi: their tools, commands, shortcuts and UI.

The daemon's runs don't load them yet. They're written for pi's interactive session, and the
daemon's runs are a different kind of thing:

- **Nobody is there.** An extension that asks you something, shows a dialog or adds a command has
  no one to show it to.
- **Runs survive restarts, extensions' memory doesn't.** A conversation that picks up after a crash
  would meet an extension that remembers nothing of it.
- **Many runs at once.** One copy of an extension would be shared by every agent working at the
  same time.
- **Your rights, unattended.** An extension's code runs with your permissions and sees every prompt
  and tool output, around the clock, on events from outside.

So, for runs without you:

- **A tool** works in both places as an [MCP server](#mcp-servers), or as a [skill](#skills) when
  it's a procedure with a script.
- **Something that should wake sedge** is a [signal](./channels-and-signals.md#your-own).
- **A model from an extension's provider** isn't available to the daemon: if it's your default,
  the daemon uses another model you're logged in to.

Loading extensions you choose, one by one, in the daemon is being looked at: their tools, their
checks on tool calls, and their model providers, never anything you haven't listed.

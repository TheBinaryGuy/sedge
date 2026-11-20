---
title: Extensions, MCP and skills
description: Your pi extensions, MCP servers and skills, and which of them the daemon's runs get.
---

Three ways to give the agent more to work with, and where each one works:

|               | The TUI | The daemon's runs                              |
| ------------- | ------- | ---------------------------------------------- |
| pi extensions | Yes     | The ones you list: see [below](#pi-extensions) |
| MCP servers   | Yes     | Yes, from your global `mcp.json`               |
| Skills        | Yes     | Yes                                            |

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
or a project's `.pi/extensions`) all load in the TUI, as in pi: their tools, commands, shortcuts
and UI.

The daemon's runs load only the ones you list, in `~/.sedge/config.json`:

```json
"piExtensions": ["protected-paths", "npm:pi-weather"]
```

An extension's name is its file's (`protected-paths` for `protected-paths.ts` or
`protected-paths/index.ts`), or the package it came in, as `sedge pi list` shows it. Restart the
daemon after changing the list. A listed name that isn't installed is reported in the daemon's log
and left out.

### What works in the daemon

- **Its tools.** They join the agent's tools, behind the same [approvals](./security.md): a tool
  sedge doesn't know asks in runs you're not watching, like an MCP tool. A tool named like one of
  sedge's own (`bash`, `read`, `send_message`, …) is left out.
- **Its checks on tool calls** (`tool_call`). They see every call the agent makes, its own and
  sedge's, and can block one or change its arguments: a protected-paths or permission-gate
  extension guards the daemon too.
- **Its model providers.** A model from an extension's provider is available to the daemon, also as
  your default.
- **Starting and stopping** (`session_start`, `session_shutdown`), once each, with the daemon.

### What doesn't

Nobody is there to answer, so anything that needs a person is gone. A dialog answers no
(`confirm` is false, a choice is empty), so a check that asks before something risky blocks it.
Commands, shortcuts, flags and renderers don't load, and an extension that sends a message, starts
a session or switches the model gets an error. Its other events (on prompts, responses, compaction)
aren't sent yet.

### Things to know

- **One copy for every agent.** The daemon loads each listed extension once, and every agent's
  runs share it, also when they run at the same time.
- **Its memory doesn't survive a restart; the conversation does.** After a crash in the middle of
  one of its tools, the agent gets an "interrupted" result rather than running it again, since it
  can't know whether that's safe.
- **Your rights, unattended.** Its code runs inside the daemon with your permissions, outside the
  [sandbox](./sandbox.md), and its checks see every tool call and result. List only extensions you
  trust as much as sedge itself.
- **A repository's own extensions** (`.pi/extensions`) never load in the daemon.

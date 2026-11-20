---
title: Configuration
description: config.json, the files in ~/.sedge, and environment variables.
---

Most things are set up by asking sedge in the TUI. The rest is `~/.sedge/config.json`. The daemon
reads it at start; after editing it, restart: `sedge stop && sedge start`.

## config.json

```json
{
    "workspace": "/Users/you/sedge-work",
    "dreaming": true,
    "permissions": { "bash": "ask", "write": "allow", "mcp": "ask" },
    "limits": { "runsPerHour": 30, "dailyCost": 5, "subagents": 6 },
    "agents": {
        "ci": { "purpose": "Watch the CI signal; tell me only when main breaks." }
    },
    "connections": {
        "telegram": { "kind": "telegram", "settings": {}, "secrets": ["token"] }
    }
}
```

| Setting             | What it does                                                                        | Default              |
| ------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| `workspace`         | Where unwatched runs work (files they create land here).                            | `~/.sedge/workspace` |
| `limits`            | What the agents may use: runs, tokens, money, subagents. See [Limits](#limits).     | unlimited            |
| `triageModel`       | The model that triages signals with `triage` on, as `provider/model`.               | cheapest of yours    |
| `dreaming`          | The nightly memory review. `false` turns it off. See [Memory](./memory.md).         | on                   |
| `permissions.bash`  | Shell commands in unwatched runs: `allow`, `ask` or `deny`.                         | `ask`                |
| `permissions.write` | File writes and edits in unwatched runs.                                            | `allow`              |
| `permissions.mcp`   | MCP tools and other tools in unwatched runs.                                        | `ask`                |
| `agents`            | Agents besides `main`, by name, each with its `purpose`. See [Agents](./agents.md). | none                 |
| `connections`       | Channels and signals by name. Written by `connect`; edit with care.                 | none                 |

Each connection has a `kind`, its `settings` (never secrets), `secrets` (the names of the
settings kept in the keychain), an optional `instruction` for a signal, an optional `agent` that
handles it (default `main`), and `enabled: false` to pause it. A signal can also have `match` and
`ignore` (regular expressions an event's text must or must not match), `when` (a condition on its
details, like `temperature > 30`), `throttle` (how long to stay quiet after an event, like `1h`),
`batch` (how long to hold its events and hand them over together, like `5m`) and `triage: true`
(a cheap model decides which events need the agent); see
[Filtering, throttling and triage](./channels-and-signals.md#filtering-throttling-and-triage).

## Limits

Every limit is off until you set it, so sedge is unlimited by default. `limits` is read again
whenever config.json changes: a new limit applies without a restart.

| Limit                | What it caps                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `limits.runsPerHour` | Runs in the last hour, for each agent with its subagents.                |
| `limits.dailyTokens` | Tokens across all agents today (local time), triage included.            |
| `limits.dailyCost`   | Money across all agents today, at the models' listed prices, in USD.     |
| `limits.subagents`   | Subagents one agent can have working at once; it's told to wait past it. |

When a limit is reached, events from signals, timers and agents wait in the inbox; nothing is
dropped, and they go on when the hour's runs age out, the day turns, or you raise the limit. Your
own messages, approvals and terminal tasks still get answers. sedge tells you once, on your
channel, for each limit it reaches.

A run counts toward the day once it ends, so the last run before a limit can take it over. Usage
comes from what the model's provider reports; a subscription login often lists no price, so use
`dailyTokens` there.

## Files

Everything lives in `~/.sedge` (or `SEDGE_HOME`):

| Path                   | What                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `config.json`          | The settings above.                                                                                             |
| `memory/`              | `main`'s [memory](./memory.md), with `MEMORY.md` as its index; each agent's is in `memory/agents/<name>/`.      |
| `workspace/`           | Where unwatched runs work.                                                                                      |
| `sedge.db`             | Inbox, timers, outbox, approvals.                                                                               |
| `agent/durable.sqlite` | The agent's conversations.                                                                                      |
| `packages/`            | Installed packages of channels and signals.                                                                     |
| `kinds/`               | Signals and channels you registered.                                                                            |
| `logs/`                | The daemon's log, and the [logs and runs](./logs-and-runs.md) `sedge dash` shows (`sedge.jsonl`, `runs.jsonl`). |
| `bin/`                 | The standalone install.                                                                                         |
| `secrets.json`         | Secrets, only on machines without a keychain.                                                                   |

Model logins, `models.json`, `mcp.json` and skills are pi's, in `~/.pi/agent`.

## Environment variables

| Variable                 | What it does                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `SEDGE_HOME`             | Use another folder than `~/.sedge` (a second, separate sedge).                           |
| `SEDGE_NO_UPDATE`        | Set to `1` to only report updates instead of installing them.                            |
| `SEDGE_AGENT_DIR`        | Use another pi agent folder for the daemon's logins and models.                          |
| `SEDGE_CODING_AGENT_DIR` | The agent folder the TUI uses (logins, models, settings, themes); default `~/.pi/agent`. |
| `SEDGE_SECRET_STORE`     | `file` keeps secrets in `~/.sedge/secrets.json` (owner-only) instead of the OS keychain. |
| `SEDGE_REGISTRY`         | The npm registry to check for updates.                                                   |
| `SEDGE_GITHUB_API`       | The GitHub API to check standalone releases against.                                     |

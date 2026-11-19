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
| `dreaming`          | The nightly memory review. `false` turns it off. See [Memory](./memory.md).         | on                   |
| `permissions.bash`  | Shell commands in unwatched runs: `allow`, `ask` or `deny`.                         | `ask`                |
| `permissions.write` | File writes and edits in unwatched runs.                                            | `allow`              |
| `permissions.mcp`   | MCP tools and other tools in unwatched runs.                                        | `ask`                |
| `agents`            | Agents besides `main`, by name, each with its `purpose`. See [Agents](./agents.md). | none                 |
| `connections`       | Channels and signals by name. Written by `connect`; edit with care.                 | none                 |

Each connection has a `kind`, its `settings` (never secrets), `secrets` (the names of the
settings kept in the keychain), an optional `instruction` for a signal, an optional `agent` that
handles it (default `main`), and `enabled: false` to pause it.

## Files

Everything lives in `~/.sedge` (or `SEDGE_HOME`):

| Path                   | What                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `config.json`          | The settings above.                                                                                        |
| `memory/`              | `main`'s [memory](./memory.md), with `MEMORY.md` as its index; each agent's is in `memory/agents/<name>/`. |
| `workspace/`           | Where unwatched runs work.                                                                                 |
| `sedge.db`             | Inbox, timers, outbox, approvals.                                                                          |
| `agent/durable.sqlite` | The agent's conversations.                                                                                 |
| `packages/`            | Installed packages of channels and signals.                                                                |
| `kinds/`               | Signals and channels you registered.                                                                       |
| `logs/daemon.log`      | The daemon's log (kept under 10 MB).                                                                       |
| `bin/`                 | The standalone install.                                                                                    |
| `secrets.json`         | Secrets, only on machines without a keychain.                                                              |

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

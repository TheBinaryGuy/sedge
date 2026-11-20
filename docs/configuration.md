---
title: Configuration
description: config.json, the files in ~/.sedge, and environment variables.
---

Most things are set up by asking sedge in the TUI. The rest is `~/.sedge/config.json`.

`agents`, `limits` and the [models](#models) are read again whenever they're used, so a change
applies at once. The rest (`workspace`, `connections`, `permissions`, `sandbox`, `triageModel`,
`piExtensions`, `dreaming`) is read when the daemon starts: after editing those, restart it with
`sedge stop && sedge start`.

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

| Setting                                      | What it does                                                                                                                               | Default              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `model`                                      | The model the daemon's runs use, as `provider/model`, with `:level` for thinking. See [Models](#models).                                   | pi's default         |
| `workspace`                                  | Where unwatched runs work (files they create land here).                                                                                   | `~/.sedge/workspace` |
| `sandbox`                                    | Commands in the OS sandbox: `enabled`, `network`, `writable`, `hidden`. See [Sandbox](./sandbox.md).                                       | off                  |
| `limits`                                     | What the agents may use: runs, tokens, money, subagents. See [Limits and costs](./limits.md).                                              | unlimited            |
| `triageModel`                                | The model that triages signals with `triage` on, as `provider/model`.                                                                      | see below            |
| `dreaming`                                   | The nightly memory review. `false` turns it off. See [Memory](./memory.md).                                                                | on                   |
| `permissions.bash`                           | Shell commands in unwatched runs: `allow`, `ask` or `deny`.                                                                                | `ask`                |
| `permissions.write`                          | File writes and edits in unwatched runs.                                                                                                   | `allow`              |
| `permissions.mcp`                            | MCP tools and other tools in unwatched runs.                                                                                               | `ask`                |
| `permissions.signals.bash`, `.write`, `.mcp` | The same, for runs woken by outside content; the stricter of the two applies. See [Security](./security.md#runs-woken-by-outside-content). | `ask`                |
| `agents`                                     | Agents besides `main`, by name, each with its `purpose`. See [Agents](./agents.md).                                                        | none                 |
| `piExtensions`                               | pi extensions to load in the daemon's runs, by name or package. See [Extensions](./mcp-and-skills.md#pi-extensions).                       | none                 |
| `connections`                                | Channels and signals by name. Written by `connect`; edit with care.                                                                        | none                 |

Each connection has a `kind`, its `settings` (never secrets), `secrets` (the names of the
settings kept in the keychain), an optional `instruction` for a signal, an optional `agent` that
handles it (default `main`), and `enabled: false` to pause it. A signal can also have `match` and
`ignore` (regular expressions an event's text must or must not match), `labels` and `wakeOn` (for
triage to label each event, and the labels that wake the agent), `remember` (keep its latest value
as a [named value](./channels-and-signals.md#named-values) instead of waking the agent), `when` (a
condition on its
details, like `temperature > 30`), `throttle` (how long to stay quiet after an event, like `1h`),
`batch` (how long to hold its events and hand them over together, like `5m`) and `triage: true`
(a cheap model decides which events need the agent); see
[Filtering, throttling and triage](./channels-and-signals.md#filtering-throttling-and-triage).

## Limits

Every limit is off until you set it. `limits` is read again whenever config.json changes, so a new
limit applies without a restart.

| Limit                | What it caps                                                 |
| -------------------- | ------------------------------------------------------------ |
| `limits.runsPerHour` | Runs in the last hour, for each agent with its subagents.    |
| `limits.dailyTokens` | Tokens across all agents today, triage included.             |
| `limits.dailyCost`   | Money across all agents today, at the models' listed prices. |
| `limits.subagents`   | Subagents one agent can have working at once.                |

What happens when one is reached, and how to spend less to begin with:
[Limits and costs](./limits.md).

## Sandbox

| Setting            | What it does                                                  | Default |
| ------------------ | ------------------------------------------------------------- | ------- |
| `sandbox.enabled`  | Runs the daemon's commands in the operating system's sandbox. | off     |
| `sandbox.network`  | Whether commands may connect anywhere.                        | `true`  |
| `sandbox.writable` | More folders it may write to.                                 | none    |
| `sandbox.hidden`   | More files and folders nothing in it may read.                | none    |

It's set when the daemon starts; restart after changing it. See [Sandbox](./sandbox.md).

## Models

The daemon's runs use pi's default model (the one `/model` picks in the TUI, at its thinking level)
unless you choose another. Three places can, and the most specific wins:

| Where                      | For                                                                    |
| -------------------------- | ---------------------------------------------------------------------- |
| `connections.<name>.model` | Runs a channel or signal wakes on its own (when it's the only source). |
| `agents.<name>.model`      | That agent's runs. See [Agents](./agents.md).                          |
| `model`                    | Every other run: main, and agents without their own.                   |

Each is `provider/model` as `/model` lists it, and may end in a thinking level (`off`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `max`), as `--model` takes it: `"anthropic/claude-opus-5-5:medium"`.
Without one, the run thinks at your default's level. A model you aren't logged in to is skipped,
with a warning in the log, and the run uses the default.

You don't need to edit the file: ask the TUI's agent ("run Telegram on Opus at medium"), which uses
`set_model` and asks you first, or send `/model` on a channel ([Channels and signals](./channels-and-signals.md#models)).
They apply from the next run, without a restart. `/model` in the TUI changes only the TUI's session
(and pi's default, which the daemon follows where nothing else is set).

## Triage model

Without `triageModel`, triage uses the cheapest priced model of your default model's provider; if
the provider lists no prices (a subscription), one whose name says it's small (`mini`, `haiku`,
`flash`, …); and failing that, your default model. Set it (`"triageModel": "openai/gpt-5-mini"`) to
choose.

## Files

Everything lives in `~/.sedge` (or `SEDGE_HOME`):

| Path                   | What                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `config.json`          | The settings above.                                                                                         |
| `sedge.sock`           | The socket the TUI and the daemon talk over (a named pipe on Windows).                                      |
| `daemon.lock`          | Holds the running daemon's process id, so only one runs.                                                    |
| `memory/`              | `main`'s [memory](./memory.md), with `MEMORY.md` as its index; each agent's is in `memory/agents/<name>/`.  |
| `workspace/`           | Where unwatched runs work.                                                                                  |
| `sedge.db`             | Inbox, timers, outbox, approvals.                                                                           |
| `agent/durable.sqlite` | The agent's conversations.                                                                                  |
| `packages/`            | Installed packages of channels and signals.                                                                 |
| `kinds/`               | Signals and channels you registered.                                                                        |
| `logs/`                | `daemon.log`, and the [logs and runs](./logs-and-runs.md) `sedge dash` shows (`sedge.jsonl`, `runs.jsonl`). |
| `bin/`                 | The standalone install.                                                                                     |
| `secrets.json`         | Secrets, only on machines without a keychain.                                                               |

Model logins, `models.json`, `mcp.json` and skills are pi's, in `~/.pi/agent`.

## Environment variables

| Variable                 | What it does                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `SEDGE_HOME`             | Use another folder than `~/.sedge` (a second, separate sedge).                            |
| `SEDGE_NO_UPDATE`        | Set to `1` to only report updates instead of installing them.                             |
| `SEDGE_AGENT_DIR`        | Another pi agent folder for the daemon: logins, models, `mcp.json`, MCP sign-ins, skills. |
| `SEDGE_CODING_AGENT_DIR` | The agent folder the TUI uses (logins, models, settings, themes); default `~/.pi/agent`.  |
| `SEDGE_SECRET_STORE`     | `file` keeps secrets in `~/.sedge/secrets.json` (owner-only) instead of the OS keychain.  |
| `SEDGE_REGISTRY`         | The npm registry to check for updates.                                                    |
| `SEDGE_GITHUB_API`       | The GitHub API to check standalone releases against.                                      |

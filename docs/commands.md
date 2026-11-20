---
title: Commands
description: Commands for the terminal and the TUI, and the tools the agents use.
---

## Command line

| Command                     | What it does                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `sedge [message]`           | Open the TUI; starts the daemon in the background if needed.                               |
| `sedge -p "<prompt>"`       | Print one reply and exit.                                                                  |
| `sedge dash [tab] [agent]`  | The dashboard, full screen: agents, inbox, runs, outbox, timers, memory, logs.             |
| `sedge start`               | Start the daemon. `--service` also starts it at login.                                     |
| `sedge stop`                | Stop the daemon now, and remove the login service; a run cut short resumes at next start.  |
| `sedge update`              | Update now. `--check` only says whether there's a new version.                             |
| `sedge install <package>`   | Install channels and signals: an official name (`telegram`, …), an npm name, or a folder.  |
| `sedge uninstall <package>` | Remove a package you installed. Disconnect what uses it first.                             |
| `sedge uninstall`           | Remove sedge; asks first (`--yes` doesn't). `--keep-data` keeps your data, not the binary. |
| `sedge pi <command>`        | pi's own commands: `install`, `remove`, `list`, `config`, `mcp`, …                         |
| `sedge --version`, `--help` |                                                                                            |

The TUI and `-p` also take the agent's options (`--model`, `--continue`, `--resume`,
`--thinking`, …); `sedge pi --help` lists them.

## In the TUI

| Command                      | What it does                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `/sedge`                     | The dashboard: agents, inbox, runs, outbox, timers, memory, logs ([Agents](./agents.md)). |
| `/sedge <tab> [agent]`       | Open the dashboard on a tab (`inbox`, `outbox`, …), or on one agent's share.              |
| `/sedge status`              | The daemon's version and what it's doing.                                                 |
| `/sedge bg <task>`           | Hand a task to the daemon; a note appears when it's done.                                 |
| `/sedge tell <agent> <task>` | The same, for one agent.                                                                  |
| `/sedge stop`                | Stop the daemon now; a run cut short resumes at the next start.                           |

All of pi's commands work too (`/login`, `/model`, `/mcp`, …).

## Tools the TUI's agent has

Ask in your own words; these are what it uses.

| Tool            | What it does                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `channels`      | What sedge talks to you on, and the channel kinds installed.                 |
| `signals`       | What wakes sedge, what it does for each, and the signal kinds installed.     |
| `find_packages` | Search npm for channels and signals, official and community (`sedge-kit`).   |
| `install`       | Install a package of channels and signals (you confirm).                     |
| `uninstall`     | Remove a package; what it provides must be disconnected first (you confirm). |
| `connect`       | Connect a channel or signal; asks for secrets in a hidden field.             |
| `invite`        | A new one-time pairing link for a channel.                                   |
| `update_signal` | Change a signal's instruction, filters, windows or triage (you confirm).     |
| `disconnect`    | Stop one and delete its settings and secrets (you confirm).                  |
| `create_signal` | Register a signal or channel module it wrote (you review it first).          |
| `agents`        | The daemon's agents, what each handles, and how each is doing.               |
| `create_agent`  | Create or change an agent: its purpose and what it handles (you confirm).    |
| `remove_agent`  | Remove an agent (you confirm).                                               |
| `tell_agent`    | Hand an agent a task and wait for its answer.                                |
| `inbox`         | What woke which agent, from where, and how it went.                          |
| `outbox`        | What the agents sent you, and whether it arrived.                            |
| `timers`        | The follow-ups and schedules the agents set.                                 |
| `state`         | The named values (`mode = away`), who set them and when.                     |

## Tools the daemon's agent has

| Tool                            | What it does                                                         |
| ------------------------------- | -------------------------------------------------------------------- |
| `send_message`                  | The only way to reach you: text, buttons (`choices`), `files`.       |
| `tell`                          | Message another agent; its answer comes back as an event.            |
| `subagent`                      | Start a helper on one task; its answer comes back as an event.       |
| `get_state`, `set_state`        | Read and set [named values](./channels-and-signals.md#named-values). |
| `set_timer`                     | A follow-up (`in`, `at`) or a schedule (`cron`).                     |
| `list_timers`, `cancel_timer`   | See and cancel this conversation's timers.                           |
| `recall`                        | Search all past conversations.                                       |
| `tool_search`                   | Find tools of MCP servers.                                           |
| `read`, `write`, `edit`, `bash` | Files and the shell (see [Security](./security.md)).                 |
| `ls`, `find`, `grep`            | Look around without the shell.                                       |

On Windows the shell tool is `powershell` instead of `bash`. A [subagent](./agents.md#subagents)
has all of these except `send_message`, `tell`, `subagent`, `set_state` and the timer tools.

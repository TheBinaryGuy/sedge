---
title: Commands
description: Commands for the terminal and the TUI, and the tools the agents use.
---

## Command line

| Command                     | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `sedge [message]`           | Open the TUI; starts the daemon in the background if needed.         |
| `sedge -p "<prompt>"`       | Print one reply and exit.                                            |
| `sedge start`               | Start the daemon. `--service` also starts it at login.               |
| `sedge stop`                | Stop the daemon after its current run, and remove the login service. |
| `sedge update`              | Update now. `--check` only says whether there's a new version.       |
| `sedge install <package>`   | Install channels and signals: `telegram`, an npm name, or a folder.  |
| `sedge pi <command>`        | pi's own commands: `install`, `remove`, `list`, `config`, `mcp`, …   |
| `sedge --version`, `--help` |                                                                      |

The TUI and `-p` also take the agent's options (`--model`, `--continue`, `--resume`,
`--thinking`, …); `sedge pi --help` lists them.

## In the TUI

| Command                      | What it does                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `/sedge`                     | The dashboard: agents, inbox, outbox, timers, memory ([Agents](./agents.md)). |
| `/sedge <tab> [agent]`       | Open the dashboard on a tab (`inbox`, `outbox`, …), or on one agent's share.  |
| `/sedge status`              | The daemon's version and what it's doing.                                     |
| `/sedge bg <task>`           | Hand a task to the daemon; a note appears when it's done.                     |
| `/sedge tell <agent> <task>` | The same, for one agent.                                                      |
| `/sedge stop`                | Stop the daemon after its current run.                                        |

All of pi's commands work too (`/login`, `/model`, `/mcp`, …).

## Tools the TUI's agent has

Ask in your own words; these are what it uses.

| Tool            | What it does                                                              |
| --------------- | ------------------------------------------------------------------------- |
| `channels`      | What sedge talks to you on, and the channel kinds installed.              |
| `signals`       | What wakes sedge, what it does for each, and the signal kinds installed.  |
| `install`       | Install a package of channels and signals (you confirm).                  |
| `connect`       | Connect a channel or signal; asks for secrets in a hidden field.          |
| `invite`        | A new one-time pairing link for a channel.                                |
| `disconnect`    | Stop one and delete its settings and secrets (you confirm).               |
| `create_signal` | Register a signal or channel module it wrote (you review it first).       |
| `agents`        | The daemon's agents, what each handles, and how each is doing.            |
| `create_agent`  | Create or change an agent: its purpose and what it handles (you confirm). |
| `remove_agent`  | Remove an agent (you confirm).                                            |
| `tell_agent`    | Hand an agent a task and wait for its answer.                             |
| `inbox`         | What woke which agent, from where, and how it went.                       |
| `outbox`        | What the agents sent you, and whether it arrived.                         |
| `timers`        | The follow-ups and schedules the agents set.                              |

## Tools the daemon's agent has

| Tool                            | What it does                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| `send_message`                  | The only way to reach you: text, buttons (`choices`), `files`. |
| `tell`                          | Message another agent; its answer comes back as an event.      |
| `set_timer`                     | A follow-up (`in`, `at`) or a schedule (`cron`).               |
| `list_timers`, `cancel_timer`   | See and cancel this conversation's timers.                     |
| `recall`                        | Search all past conversations.                                 |
| `tool_search`                   | Find tools of MCP servers.                                     |
| `read`, `write`, `edit`, `bash` | Files and the shell (see [Security](./security.md)).           |
| `ls`, `find`, `grep`            | Look around without the shell.                                 |

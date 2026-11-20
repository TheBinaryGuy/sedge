---
title: Security
description: What sedge does without asking, where your secrets go, and who can talk to it.
---

sedge runs with your rights on your machine. These are the limits it keeps.

## Runs you watch, and runs you don't

- **Watched**: anything you start from the terminal (the TUI, `sedge -p`, `/sedge bg`). Tools run
  as in any coding agent.
- **Unwatched**: everything else (a Telegram message, a signal, a timer, a dream). Here the
  permission policy applies.

## The permission policy

| Tool                                                                          | Unwatched runs                         | Runs woken by outside content                     |
| ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Reading and searching (`read`, `grep`, `find`, `ls`, `recall`, `tool_search`) | allowed                                | allowed                                           |
| Writing files (`write`, `edit`)                                               | `permissions.write`, default **allow** | also `permissions.signals.write`, default **ask** |
| Shell (`bash`)                                                                | `permissions.bash`, default **ask**    | also `permissions.signals.bash`, default **ask**  |
| MCP tools and anything else                                                   | `permissions.mcp`, default **ask**     | also `permissions.signals.mcp`, default **ask**   |
| sedge's own (`send_message`, `tell`, `subagent`, timers)                      | allowed                                | allowed                                           |

`ask` holds the call and sends you the exact command with **Approve** / **Deny** buttons on your
channel. Approving lets that exact call (same tool, same input) through once; the agent makes it
again. Denying tells the agent to find another way. With no channel connected, an `ask` call is
refused. Set any of the three to `allow`, `ask` or `deny` in the [config](./configuration.md).

### Runs woken by outside content

What a signal reports was written by someone else: a CI log, a webhook body, a feed, a message on
an MQTT topic. Text in it that reads like an instruction is framed as data, but a model can still
be talked into things. So a run that has outside content in it gets stricter rules: for each kind
of tool, the stricter of `permissions` and `permissions.signals`, which **asks for everything by
default**. Writing files, which unwatched runs may otherwise do freely, needs your approval there.

A run counts as woken by outside content when any of its events is:

- a signal's event;
- a message, a subagent's task, or a subagent's answer passed on by such a run;
- a timer such a run set.

Your own messages, approvals and terminal tasks never are, and a run that has only those keeps the
usual rules. A run a restart resumes is treated as outside content, since what woke it isn't known
then. The agent is told when its run is one of these, so it doesn't try what it can't do.

To let a trusted signal's runs do more, loosen `permissions.signals`:

```json
"permissions": { "signals": { "write": "allow" } }
```

It can never make them looser than `permissions` itself.

## The sandbox

Approvals decide whether a command runs; the [sandbox](./sandbox.md) limits what it can do once it
does. With it on, the daemon's commands run in the operating system's sandbox (Seatbelt on macOS,
bubblewrap on Linux): they can only write in the run's folder, the workspace, temp and the folders
you allow, can't read the credentials it hides (SSH keys, cloud, git and npm logins, your pi logins)
or sedge's secrets, and can be cut off from the network. It's off unless you turn it on.

## Off limits, always

In the daemon's runs, watched or not, a tool call that names `~/.sedge/config.json` or the fallback
secrets file by its full path is refused. That stops the agent reaching for them directly, not every
way there (a relative path, a script that reads them); with the [sandbox](./sandbox.md) on, they're
hidden for real. The TUI's own agent is told never to read them.

## Secrets

Tokens and passwords for channels and signals are typed into a hidden field in the TUI. They go
straight to the daemon and into your OS keychain (one keychain entry per sedge home); they never
appear in the chat, the model's context, the config or the logs. `disconnect` deletes them. On a
machine without a keychain, they go to `~/.sedge/secrets.json`, readable only by you.

## Who can talk to sedge

A channel answers only accounts paired through a one-time invite link that sedge shows on your
screen. Anyone else gets silence: no error, no hint that a bot is there.

## Outside content

What a signal reports is framed as data from outside, so instructions inside it aren't followed.
Project MCP config (`.pi/mcp.json`) isn't read by the daemon, so a repository can't add tools to
unwatched runs.

## Nothing leaves your machine

sedge sends no telemetry. Its [logs and runs](./logs-and-runs.md) stay in `~/.sedge/logs`, for
you to read in `sedge dash`.

## Code you add

Packages you install and signals you register run inside the daemon with your rights, outside
[the sandbox](#the-sandbox). In the TUI, sedge asks before installing a package (saying when it's
a community one, with its npm page) and before registering a signal it wrote, showing you the file;
what you approve is copied, and that copy is what runs. `sedge install` on the command line
installs what you name.

pi extensions you list in `piExtensions` run inside the daemon too, unattended and outside the
sandbox, and their checks see every tool call; see
[pi extensions](./mcp-and-skills.md#pi-extensions). None load unless you list them.

The `command` signal runs the command you give it in your shell, with your rights, for as long as
it's connected; you see the command before you confirm. The `webhook` signal listens only on this
machine unless you set its `host`, and turns away any request without the token you chose.

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

`ask` holds the call and sends you the whole of it with **Approve** / **Deny** buttons on your
channel: the command in full, a write's content, an edit's changes, and whether the run was woken by
outside content. Past what fits in one message it's cut, and says so: deny what you can't see. Approving lets that exact call (same tool, same input) through once; the agent makes it
again. Denying tells the agent to find another way. With no channel connected, an `ask` call is
refused. Set any of the three to `allow`, `ask` or `deny` in the [config](./configuration.md).

### Runs woken by outside content

What a signal reports was written by someone else: a CI log, a webhook body, a feed, a message on
an MQTT topic. Text in it that reads like an instruction is framed as data, but a model can still
be talked into things. So a run that has outside content in it gets stricter rules: for each kind
of tool, the stricter of `permissions` and `permissions.signals`, which **asks for everything by
default**. Writing files outside the run's own folder and the workspace, which unwatched runs may
otherwise do freely, needs your approval there; writes inside them follow your usual
`permissions.write`, since that's where the run's work goes. A project's `.pi` folder inside them
isn't: what's written there (a skill, an extension) is loaded by later runs, so it asks. Such a run
can't change [named values](./channels-and-signals.md#named-values) either.

A run counts as woken by outside content when any of its events is:

- a signal's event;
- a message, a subagent's task, or a subagent's answer passed on by such a run;
- a timer such a run set;
- your answer to an approval such a run asked for, approve or deny: its conversation still holds
  what it read;
- your pick of a button such a run offered: you pressed it, but someone else's text chose what it
  says.

Your own messages and terminal tasks never are, and a run that has only those keeps the usual
rules. A run a restart resumes is treated as outside content, since what woke it isn't known
then. The agent is told when its run is one of these, so it doesn't try what it can't do.

To let a trusted signal's runs do more, loosen `permissions.signals`:

```json
"permissions": { "signals": { "write": "allow" } }
```

It can never make them looser than `permissions` itself.

Buttons the agent offers can't pass for these approve and deny ones: sedge marks every button it
didn't make itself, and a pick on a button an outside-content run made carries that along.

## The sandbox

Approvals decide whether a command runs; the [sandbox](./sandbox.md) limits what it can do once it
does. With it on, the daemon's commands run in the operating system's sandbox (Seatbelt on macOS,
bubblewrap on Linux): they can only write in the run's folder, the workspace, temp and the folders
you allow, can't read the credentials it hides (SSH keys, cloud, git and npm logins, your pi logins)
or sedge's secrets, and can be cut off from the network. It's off unless you turn it on.

## Off limits, always

sedge's own files are everything in `~/.sedge` but the memory and the workspace: its config and
secrets, the socket the TUI and the daemon talk over, the database (inbox, approvals), the
conversations, logs, packages and binary. In the daemon's runs, watched or not:

- **A file tool** (`read`, `write`, `edit`, `ls`, `find`, `grep`) that names one of them is refused,
  however it's named: a full path, `~/.sedge/config.json`, `../config.json` from the workspace, or
  a link that leads there. `find` and `grep` skip them in every folder they search.
- **`send_message`** won't attach one.
- **A shell command** isn't judged by its text, which can't be read reliably. With the
  [sandbox](./sandbox.md) on, commands can't reach these files or the socket. With it off, every
  command in a run you're not watching already needs your approval, and the approval shows it in
  full.

The TUI's own agent is told never to read them.

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

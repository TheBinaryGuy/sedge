---
title: Security
description: What sedge may do without you, where secrets live, who can talk to it, and what stays off limits.
---

sedge runs with your rights on your machine. These are the limits it keeps.

## Runs you watch, and runs you don't

- **Watched**: anything you start from the terminal (the TUI, `sedge -p`, `/sedge bg`). Tools run
  as in any coding agent.
- **Unwatched**: everything else (a Telegram message, a signal, a timer, a dream). Here the
  permission policy applies.

## The permission policy

| Tool                                                                          | Unwatched runs                         |
| ----------------------------------------------------------------------------- | -------------------------------------- |
| Reading and searching (`read`, `grep`, `find`, `ls`, `recall`, `tool_search`) | allowed                                |
| Writing files (`write`, `edit`)                                               | `permissions.write`, default **allow** |
| Shell (`bash`)                                                                | `permissions.bash`, default **ask**    |
| MCP tools and anything else                                                   | `permissions.mcp`, default **ask**     |
| sedge's own (`send_message`, timers)                                          | allowed                                |

`ask` holds the call and sends you the exact command with **Approve** / **Deny** buttons on your
channel. Approving lets that exact call (same tool, same input) through once; the agent makes it
again. Denying tells the agent to find another way. With no channel connected, an `ask` call is
refused. Set any of the three to `allow`, `ask` or `deny` in the [config](./configuration.md).

## Off limits, always

No run, watched or not, may read or change `~/.sedge/config.json` or the fallback secrets file.

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

## Code you add

Packages you install and signals you register run inside the daemon with your rights, outside any
sandbox. sedge asks before installing or registering, and shows you the file to review. What you
approve is copied, and that copy is what runs.

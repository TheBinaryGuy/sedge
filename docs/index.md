---
title: sedge
description: An always-on agent that lives on your machine. What it is, and where to read next.
---

sedge is an agent that keeps working after you close the terminal. You talk to it in a TUI on
your computer, or from your phone on Telegram. It wakes when something happens (a message, a
timer, your CI failing), does the work, tells you what matters, and goes back to sleep.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./architecture-dark.svg">
  <img src="./architecture-light.svg" alt="How sedge works: channels, signals, timers and the terminal put events into the inbox; a durable run works with memory, skills, MCP servers, tools and approvals; what it sends leaves through the outbox to you, and your reply comes back as an event." width="100%">
</picture>

It has two halves:

- **The TUI** (`sedge`): a coding agent in your terminal, built on
  [pi](https://github.com/earendil-works/pi). Everything pi does works here, plus tools to set
  sedge up.
- **The daemon** (`sedge start`): runs in the background. It holds an inbox of events, fires
  timers, keeps memory, asks before risky actions, and sends you messages. Its conversations are
  durable: a run cut short by a restart picks up where it stopped.

## Read next

| If you want to…                               | Read                                              |
| --------------------------------------------- | ------------------------------------------------- |
| Install it and talk to it from your phone     | [Getting started](./getting-started.md)           |
| Understand what happens when an event arrives | [How it works](./how-it-works.md)                 |
| Connect Telegram, or get woken by your CI     | [Channels and signals](./channels-and-signals.md) |
| Know what it remembers, and how               | [Memory](./memory.md)                             |
| Give it your MCP servers and skills           | [MCP and skills](./mcp-and-skills.md)             |
| Know what it can and can't do without you     | [Security](./security.md)                         |
| Change a setting                              | [Configuration](./configuration.md)               |
| Look up a command or tool                     | [Commands](./commands.md)                         |
| Write a channel or signal of your own         | [The kit](./kit.md)                               |
| Work on sedge itself                          | [Development](./development.md)                   |

## For agents

These pages are plain Markdown, one topic each, and every page starts with a one-line
description. The TUI's agent already knows sedge's basics and links here; the daemon's agent is
sedge.

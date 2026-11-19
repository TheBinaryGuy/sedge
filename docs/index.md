---
title: Introduction
description: An always-on agent that lives on your machine.
---

sedge is an agent that keeps working after you close the terminal. You talk to it in a TUI on
your computer, or from your phone on Telegram. It wakes when something happens (a message, a
timer, your CI failing), does the work, tells you what matters, and goes back to sleep.

![How sedge works: events go into the inbox, a durable run handles them, and what it says leaves through the outbox](./architecture-light.svg#gh-light-mode-only)
![How sedge works: events go into the inbox, a durable run handles them, and what it says leaves through the outbox](./architecture-dark.svg#gh-dark-mode-only)

It has two halves:

- **The TUI** (`sedge`): a coding agent in your terminal, built on
  [pi](https://github.com/earendil-works/pi). Everything pi does works here, plus tools to set
  sedge up.
- **The daemon** (`sedge start`): runs in the background. It holds an inbox of events, fires
  timers, keeps memory, asks before risky actions, and sends you messages. Its conversations are
  durable: a run cut short by a restart picks up where it stopped.

## Use it

[Getting started](./getting-started.md) · [Channels and signals](./channels-and-signals.md) ·
[Memory](./memory.md) · [MCP and skills](./mcp-and-skills.md)

## Understand it

[How it works](./how-it-works.md) · [Security](./security.md)

## Look things up

[Commands](./commands.md) · [Configuration](./configuration.md)

## Build on it

[The kit](./kit.md) · [Development](./development.md)

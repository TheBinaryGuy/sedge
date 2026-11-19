---
title: How it works
description: Events go into an inbox, a run handles them, and replies leave through an outbox.
---

![How sedge works: events go into the inbox, a durable run handles them, and what it says leaves through the outbox](./architecture-light.svg#gh-light-mode-only)
![How sedge works: events go into the inbox, a durable run handles them, and what it says leaves through the outbox](./architecture-dark.svg#gh-dark-mode-only)

An always-on agent is not running all the time. It sleeps until something happens, wakes for a
short run, and sleeps again. sedge follows the pattern in
[Building always-on agents](https://claude.com/resources/articles/building-always-on-agents),
with five parts.

## The event inbox

Everything that should wake the agent becomes an event in the inbox, a table in
`~/.sedge/sedge.db`:

- a message on a [channel](./channels-and-signals.md) (Telegram);
- a [signal](./channels-and-signals.md) firing (CI failed);
- a timer coming due;
- your answer to an approval;
- a task from the terminal (`/sedge bg <task>` in the TUI).

Each event has an id from its source, so one that arrives twice is stored once. The worker
drains the inbox: up to four runs at once, never two for the same conversation. Events that
arrive while a conversation's run is going are answered together in its next run, so three
quick messages get one reply, not three.

## The run

A run is the agent at work: [pi](https://github.com/earendil-works/pi)'s model, with tools to read
and edit files, run commands, search, and reach you. Runs live on
[pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable): each conversation
is kept in SQLite (`~/.sedge/agent/durable.sqlite`), so a run cut short by a crash, an update or a
restart resumes where it stopped. Every event is submitted with its inbox id, so even a repeat
after a restart is answered once.

Conversations are called threads:

- `main`: you and sedge, on every channel. Signals report here too, unless they belong to an agent.
- `agent:<name>`: each [agent](./agents.md) you made. Agents message each other with `tell`.
- `cli:<folder>`: a task from the terminal, one per folder.
- `dream`: the nightly [memory](./memory.md) review.

## Timers

The agent sets its own: a follow-up (`in 2h`, `at 2026-12-01T09:00`) or a schedule (cron, in your
time zone). When one comes due it becomes an event. If the agent says it will check back, it has
set a timer.

## Memory

A folder of files the agent keeps. A short index is loaded into every run; the rest is read when
needed, and every night the agent reviews and tidies it. See [Memory](./memory.md).

## Permissions and approvals

In runs you're not watching, risky tool calls (shell commands, MCP tools) wait for your say-so.
The agent's call is held, you get the command with Approve / Deny buttons, and your answer comes
back as an event. See [Security](./security.md).

## The outbox

Nothing the agent writes reaches you unless it calls `send_message`. Messages go to the outbox
table first, and a dispatcher delivers them to the channel you last wrote from, retrying on
failure. Messages can carry buttons (your pick comes back as an event) and files.

## The two processes

- **The TUI** (`sedge`) is pi's interactive session with sedge's extension. Its own chat stays in
  the TUI; it talks to the daemon only to show status, hand off background tasks and set things
  up.
- **The daemon** (`sedge start`) runs everything above. The two talk over a Unix socket
  (`~/.sedge/sedge.sock`). `sedge` never waits for the daemon: it starts it in the background and
  connects when it's up.

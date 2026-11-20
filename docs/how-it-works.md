---
title: How it works
description: Events go into an inbox, a run handles them, and replies leave through an outbox.
---

![How sedge works: events go into the inbox, a durable run handles them, and what it says leaves through the outbox](./architecture-light.svg#gh-light-mode-only)
![How sedge works: events go into the inbox, a durable run handles them, and what it says leaves through the outbox](./architecture-dark.svg#gh-dark-mode-only)

An always-on agent is not running all the time. sedge is event-driven: it sleeps until something
happens, wakes for a short run, and sleeps again. sedge follows the pattern in
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
drains the inbox: a run for every conversation with work, all at once, never two for the same one. Events that
arrive while a conversation's run is going are answered together in its next run, so three
quick messages get one reply, not three. A signal with a `batch` window holds its events for that
long, so a burst of them gets one run too, and one with `triage` on has a cheap model decide first
whether its events need a run at all. [Limits](./limits.md), when you set them, hold
automated events back once an agent has had its runs for the hour or the day's budget is spent.

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
- `<thread>#sub:<id>`: a [subagent](./agents.md#subagents) an agent started for one task. Its
  answer goes back to that agent's thread as an event.
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

## Limits and the sandbox

Two optional settings bound what the agent can do on its own:

- **Limits** cap runs per hour for each agent, tokens and money per day, and subagents at once.
  When one is reached, automated events wait in the inbox and your own messages still go through.
  See [Limits and costs](./limits.md).
- **The sandbox** runs the agent's commands in the operating system's sandbox, so they write only
  where you allow and never read your credentials. See [Sandbox](./sandbox.md).

## The outbox

Nothing the agent writes reaches you unless it calls `send_message`. Messages go to the outbox
table first, and a dispatcher delivers them to the channel you last wrote from, retrying on
failure. Messages can carry buttons (your pick comes back as an event) and files.

## The two processes

- **The TUI** (`sedge`) is pi's interactive session with sedge's extension. Its own chat stays in
  the TUI; it talks to the daemon only to show status, hand off background tasks and set things
  up. Your pi extensions load here.
- **The daemon** (`sedge start`) runs everything above. The two talk over a Unix socket
  (`~/.sedge/sedge.sock`). `sedge` never waits for the daemon: it starts it in the background and
  connects when it's up. Its runs get your MCP servers and skills, but not pi extensions; see
  [Extensions, MCP and skills](./mcp-and-skills.md).

## Prior art

- [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents),
  from Claude: the pattern above. An event inbox, short runs that survive restarts, timers,
  memory, approvals and an outbox.
- [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory),
  from Anthropic: how [memory](./memory.md) is laid out, and the nightly review.
- [Pine](https://github.com/pmndre/pine), a reactive harness for agents: another agent that runs
  in the background and wakes when something happens.

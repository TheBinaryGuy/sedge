---
title: Limits and costs
description: What runs cost, where to see it, and the limits that keep an always-on agent within a budget.
---

An always-on agent spends while you're not looking: every run is a model call, a signal can fire
all day, and an agent can start subagents. sedge puts no cap on any of it by default. These are the
ways to see what it uses and to keep it within what you want to spend.

## What a run costs

A run uses tokens: the system prompt and memory, the conversation so far, the events that woke it,
and every tool call and result. sedge reads the totals from the model's provider after each run,
whether it answered or failed, and prices them at the model's listed price (USD). A subscription
login (a ChatGPT or Claude plan) often lists no price: its runs count tokens, at $0.

`sedge dash runs` shows each run's tokens and cost when you select it, next to its tool calls. See
[Logs and runs](./logs-and-runs.md).

## Spend less on each event

Most of an always-on agent's cost comes from signals: one run per event adds up. Before reaching
for limits, make fewer runs:

- **Filters** (`match`, `ignore`, `when`) drop events that don't matter, for free.
- **`throttle`** keeps a repeating alarm to one run per window.
- **`batch`** gathers a noisy signal's events into one run.
- **`triage`** has a cheap model read each event first and wake the agent only when your
  instruction calls for it, for a small call instead of a run.

See [Filtering, throttling and triage](./channels-and-signals.md#filtering-throttling-and-triage).

## Limits

Limits are a ceiling, for a runaway loop or a signal gone wild. Each is off until you set it in
`~/.sedge/config.json`:

```json
"limits": { "runsPerHour": 30, "dailyTokens": 2000000, "dailyCost": 5, "subagents": 6 }
```

| Limit                | What it caps                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `limits.runsPerHour` | Runs in the last hour, for each agent with its subagents.            |
| `limits.dailyTokens` | Tokens across all agents today (local time), triage included.        |
| `limits.dailyCost`   | Money across all agents today, at the models' listed prices, in USD. |
| `limits.subagents`   | Subagents one agent can have working at once.                        |

`limits` is read again whenever config.json changes: a new limit applies without a restart.

### When one is reached

- Events from signals, timers and other agents **wait in the inbox**. Nothing is dropped: they go
  on when the hour's runs age out, the day turns, or you raise the limit.
- **Your own messages, approvals and terminal tasks still get answers**, even past a limit.
- sedge **tells you once** on your channel for each limit it reaches ("Sedge has paused automated
  work: today's budget of $5.00 is used up").
- Past `subagents`, an agent that tries to start another is told to wait for the ones it has, or
  to do the part itself.

A run counts toward the day once it ends, so the run that crosses a limit finishes. Usage is what
the provider reports; with a subscription login, use `dailyTokens`, as its cost reads $0.

## What it doesn't cover

- The TUI's own chat is pi's, with your login's own limits; sedge's limits apply to the daemon.
- MCP servers and tools that call paid services bill you there, not through the model.

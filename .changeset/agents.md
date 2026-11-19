---
'@sedge-hq/sedge': minor
---

Agents. Besides `main`, you can have agents with a purpose of their own ("watch my CI and only tell me when main breaks"), each with its own durable conversation and memory, handling the channels and signals you give it. They run side by side and message each other through the inbox with `tell`. Ask for one in the TUI; `/sedge` opens a dashboard of agents, the inbox, the outbox, timers and memory, and `/sedge tell <agent> <task>` hands one a task.

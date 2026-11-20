---
'@sedge-hq/sedge': minor
---

Agents can start subagents: helpers that each take one task, work in parallel, and report back
to the agent that started them as a new event, so it stays free for your messages meanwhile.
Every agent with work now runs at the same time, instead of four at most.

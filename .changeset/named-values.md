---
'@sedge-hq/sedge': minor
---

Named values: small facts like `mode = away` that signals' conditions read as `state.<name>`
(`when: state.mode = away`). A signal with `remember` keeps its latest value under a name instead
of waking the agent, and the daemon's agent sets them with `set_state` ("I'm away till Sunday").
They survive restarts; the TUI's `state` tool lists them.

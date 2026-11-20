---
'@sedge-hq/sedge': minor
---

Signals get three more ways to decide what reaches the agent. `when` lets through only events
whose details meet a condition, like `temperature > 30 and room = kitchen`. `throttle` stays quiet
for a while after an event gets through. `triage` has a cheap model read each event with your
instruction first, and the agent wakes only when it should; skipped events show in the inbox with
the reason. `triageModel` in the config picks the model; the cheapest of your provider's is used
otherwise.

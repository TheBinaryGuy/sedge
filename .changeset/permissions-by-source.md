---
'@sedge-hq/sedge': minor
---

Runs woken by outside content get stricter permissions: a signal's events, and what a run woken by
one passes on (a message to another agent, a subagent, a timer), use the stricter of `permissions`
and the new `permissions.signals`, which asks for everything by default. This changes one default:
such runs now ask before writing files. Loosen it with `"permissions": { "signals": { "write":
"allow" } }`. Your own messages and terminal tasks keep the usual rules.

Signals can also have `labels`: the cheap triage model tags each event with one ("person",
"nothing"), the agent and `sedge dash` see it, and `wakeOn` wakes the agent only for the labels you
choose.

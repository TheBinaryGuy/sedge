---
'@sedge-hq/sedge': minor
---

Signals can be filtered and batched: `match` and `ignore` decide which events reach the agent,
and `batch` holds a noisy signal's events for a while and hands them over in one run. Set them
when connecting, or change them later with the new `update_signal` tool. The official packages
now include `local`, with webhook, files and command signals.

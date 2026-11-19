---
'@sedge-hq/sedge': minor
---

See what sedge did, on your machine only. Every run is recorded with what woke it, how long it took, how it ended and each tool call's timing; every log line (sedge's own, and what pi, MCP servers, channels and signals print) is kept with its level. `sedge dash` has `runs` and `logs` tabs, and its header counts runs, failures and run times since the daemon started, from Effect's metrics. It's all in `~/.sedge/logs`; nothing is sent anywhere.

---
'@sedge-hq/sedge': patch
---

The last runs and log lines are written to `~/.sedge/logs` before the daemon stops, instead of
sometimes being lost on shutdown.

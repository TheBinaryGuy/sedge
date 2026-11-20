---
'@sedge-hq/sedge': minor
---

pi extensions in the daemon: list them in `piExtensions` in config.json, and their tools, their
`tool_call` checks and their model providers work in runs you're not watching. Nothing loads
unless listed. What needs a person doesn't carry over: dialogs answer no, so a check that asks
before something risky blocks it.

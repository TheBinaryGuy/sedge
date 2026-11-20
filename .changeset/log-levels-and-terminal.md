---
'@sedge-hq/sedge': patch
---

The daemon's log no longer shows routine news as errors: a paired account, MCP servers that
connected and the pi extensions it loaded are info, and only failures are errors. A task you hand
the daemon from the terminal (`tell_agent`, `/sedge tell`, `/sedge bg`) can message you on your
channel when you ask it to, instead of refusing because you started it in the terminal.

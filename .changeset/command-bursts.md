---
'@sedge-hq/local': patch
---

The `command` signal reports lines a command prints together as one event, whatever way the
system splits its output: it waits for a quarter-second pause, or 200 lines, before reporting.

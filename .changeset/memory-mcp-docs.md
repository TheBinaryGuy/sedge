---
'@sedge-hq/sedge': minor
---

The daemon's runs get your MCP servers (from your global `mcp.json`, found on demand with `tool_search`, approval first when you're not watching) and your skills. Memory follows Anthropic's "components of agent memory": a short `MEMORY.md` index loaded into every run, the rest read when needed, `recall` to search every past conversation, and a nightly dream that checks notes against what happened and tidies them (`"dreaming": false` turns it off). The TUI gets sedge's own theme in the logo's green, and there are docs now, in `docs/`.

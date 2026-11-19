# sedge

## 0.1.0

### Minor Changes

- [`101562a`](https://github.com/sedge-hq/sedge/commit/101562a30377f2f53d2dde2cd8f1c2851be417fd) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Channels and signals. A channel is how sedge and you talk (Telegram first); a signal wakes it when something happens elsewhere, with your instruction for what to do then. Ask in the TUI ("set up telegram", "tell me when my CI fails"): sedge installs the package, asks for secrets in a hidden field and keeps them in your OS keychain, and pairs your account with a one-time invite link. Channels show "typing…" while sedge works, and its messages can carry buttons and files. Write your own with `defineSignal` and `defineChannel` from `@sedge-hq/kit`.
  
  The daemon's agent now runs on pi-durable: every conversation lives in SQLite, a run cut short by a crash or restart resumes where it stopped, and an event that arrives twice is answered once. Under it all are the always-on pieces: an inbox that answers queued events together, timers the agent sets itself, memory files, an outbox with retries, and approvals for risky tool calls that you answer from your phone.

- [`8da2cd6`](https://github.com/sedge-hq/sedge/commit/8da2cd6afea46277a8e67bba02fddb4e59e1e8d5) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - The daemon's runs get your MCP servers (from your global `mcp.json`, found on demand with `tool_search`, approval first when you're not watching) and your skills. Memory follows Anthropic's "components of agent memory": a short `MEMORY.md` index loaded into every run, the rest read when needed, `recall` to search every past conversation, and a nightly dream that checks notes against what happened and tidies them (`"dreaming": false` turns it off). The TUI gets sedge's own theme in the logo's green, and there are docs now, in `docs/`.

### Patch Changes

- [`d3ac977`](https://github.com/sedge-hq/sedge/commit/d3ac977324256d1fddf9f9e7d4ea2aeaa366490d) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Fix a daemon loop that could fill the disk: when the inbox worker or scheduler keeps failing (for example after its database is deleted), it now waits 1 s, 2 s, 4 s … up to a minute between retries and logs one line per repeat. `daemon.log` also rotates past 10 MB.

- [`73cd2bf`](https://github.com/sedge-hq/sedge/commit/73cd2bf584a00c2be98af71f3fdc44793edf3a11) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Install with `curl -fsSL sedge.sh | sh`. Standalone installs now download from GitHub releases and update themselves from there, checking each download against its sha256.

## 0.0.1

### Patch Changes

- [`c24677f`](https://github.com/TheBinaryGuy/sedge/commit/c24677fb967582d400df6085dc4a670136a68a40) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - First release: pi's TUI and print mode as `sedge`, with a background daemon (inbox, timers, self-update) that keeps working after you close the terminal.

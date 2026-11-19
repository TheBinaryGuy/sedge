# sedge

## 0.6.0

### Minor Changes

- [`45d13cd`](https://github.com/sedge-hq/sedge/commit/45d13cdfbb89d3de602f0668ddce33f343fbecde) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - `sedge uninstall` removes sedge from your machine: the daemon, the login service, its keychain
  secrets and `~/.sedge`, after showing what goes and asking (`--keep-data` keeps `~/.sedge`).
  `sedge uninstall <package>` removes a package of channels and signals, and the agent can do that
  too with the `uninstall` tool. A package stays while anything it provides is connected.

## 0.5.0

### Minor Changes

- [`0e1ad34`](https://github.com/sedge-hq/sedge/commit/0e1ad34725d723fa8941b241e2f52ddb01997772) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - New official packages: `@sedge-hq/slack`, a second channel over Socket Mode (DMs, buttons, files, pairing by code); `@sedge-hq/github`, with `github-ci` for failing Actions runs and `github` for reviews asked of you, assignments and mentions; and `@sedge-hq/web`, with `web-page` for pages whose text changes and `feed` for new posts on RSS and Atom feeds. MCP servers that sign in with OAuth now work in the daemon too, using the sign-in you did in the TUI. A signal's `every` can depend on its settings.

## 0.4.0

### Minor Changes

- [`5249738`](https://github.com/sedge-hq/sedge/commit/5249738797a74ac1e2821846d9f0f9cbd3bc451e) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - See what sedge did, on your machine only. Every run is recorded with what woke it, how long it took, how it ended and each tool call's timing; every log line (sedge's own, and what pi, MCP servers, channels and signals print) is kept with its level. `sedge dash` has `runs` and `logs` tabs, and its header counts runs, failures and run times since the daemon started, from Effect's metrics. It's all in `~/.sedge/logs`; nothing is sent anywhere.

## 0.3.1

### Patch Changes

- [`710b528`](https://github.com/sedge-hq/sedge/commit/710b528aaa90b6de0c39797b3964a7d02eb6c35c) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - `@sedge-hq/kit` is plain TypeScript now: a signal is `every` plus an `async check` (or an async generator for sources that push), a channel is an `async connect` returning plain functions, and secrets arrive as strings. Effect still runs everything underneath (settings decoding, retries, clean stops), and failures now retry with exponential, jittered backoff from 2 seconds to 5 minutes, saying when in the status line. The Effect API moves to `@sedge-hq/kit/effect`. Telegram is rewritten on the plain API, as the example to copy.

## 0.3.0

### Minor Changes

- [`6779ee2`](https://github.com/sedge-hq/sedge/commit/6779ee254845e9c29bb12acba58daf93432c7077) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - `sedge dash`: the dashboard on its own, full screen, with the daemon's status on top, a tab each for agents, the inbox, the outbox, timers and memory, an agent filter, and the selected item in full; it refreshes every two seconds. `/sedge` in the TUI is the same view. The TUI's theme now shades thinking levels in sedge's green. `SEDGE_SECRET_STORE=file` keeps secrets in a file instead of the keychain. The docs have screenshots.

- [`7911183`](https://github.com/sedge-hq/sedge/commit/79111832712f12ecc90e6b76da4797eb749f7722) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Channels and signals import everything from `@sedge-hq/kit`: it hands you Effect's `Effect`, `Stream`, `Schedule`, `Schema`, `Option`, `Redacted` and `Duration`, plus `field.*` settings, `poll(every, check)` and `fetchJson`, so a package needs no `effect` dependency of its own. Community packages: anything tagged `sedge-kit` on npm shows up when you ask sedge to look (`find_packages`), and installing one says plainly that sedge didn't review it. The docs explain how to publish your own.

## 0.2.0

### Minor Changes

- [`8dc3ac6`](https://github.com/sedge-hq/sedge/commit/8dc3ac6758982eba53d8a5c76602a25c25d13452) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Agents. Besides `main`, you can have agents with a purpose of their own ("watch my CI and only tell me when main breaks"), each with its own durable conversation and memory, handling the channels and signals you give it. They run side by side and message each other through the inbox with `tell`. Ask for one in the TUI; `/sedge` opens a dashboard of agents, the inbox, the outbox, timers and memory, and `/sedge tell <agent> <task>` hands one a task.

## 0.1.1

### Patch Changes

- [`1e6f7ca`](https://github.com/sedge-hq/sedge/commit/1e6f7ca8cf86ca52efb50a7c16d497cc19b4a5c7) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - The npm pages show the logo, the diagram and working links, point at sedge.sh, and the kit and Telegram packages have READMEs of their own.

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

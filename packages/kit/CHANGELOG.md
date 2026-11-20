# @sedge-hq/kit

## 0.3.3

### Patch Changes

- [`ddceba7`](https://github.com/sedge-hq/sedge/commit/ddceba756e262824740f5827d20e84fceb62ecf4) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Updated READMEs: each package's settings, the details its events carry for sedge's `when`
  conditions, and in the kit, optional secrets and putting a happening's data in `details`.

## 0.3.2

### Patch Changes

- [`6578312`](https://github.com/sedge-hq/sedge/commit/65783129c655d5296ae08b5c99c3dae0b027dcb1) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - `field.optional(secret(...))` stays a secret: it's typed into a hidden field and kept in the
  keychain, and your code gets it as a plain string. Before, wrapping a secret made it an ordinary
  setting.

## 0.3.1

### Patch Changes

- [`0e1ad34`](https://github.com/sedge-hq/sedge/commit/0e1ad34725d723fa8941b241e2f52ddb01997772) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - New official packages: `@sedge-hq/slack`, a second channel over Socket Mode (DMs, buttons, files, pairing by code); `@sedge-hq/github`, with `github-ci` for failing Actions runs and `github` for reviews asked of you, assignments and mentions; and `@sedge-hq/web`, with `web-page` for pages whose text changes and `feed` for new posts on RSS and Atom feeds. MCP servers that sign in with OAuth now work in the daemon too, using the sign-in you did in the TUI. A signal's `every` can depend on its settings.

## 0.3.0

### Minor Changes

- [`710b528`](https://github.com/sedge-hq/sedge/commit/710b528aaa90b6de0c39797b3964a7d02eb6c35c) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - `@sedge-hq/kit` is plain TypeScript now: a signal is `every` plus an `async check` (or an async generator for sources that push), a channel is an `async connect` returning plain functions, and secrets arrive as strings. Effect still runs everything underneath (settings decoding, retries, clean stops), and failures now retry with exponential, jittered backoff from 2 seconds to 5 minutes, saying when in the status line. The Effect API moves to `@sedge-hq/kit/effect`. Telegram is rewritten on the plain API, as the example to copy.

## 0.2.0

### Minor Changes

- [`7911183`](https://github.com/sedge-hq/sedge/commit/79111832712f12ecc90e6b76da4797eb749f7722) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Channels and signals import everything from `@sedge-hq/kit`: it hands you Effect's `Effect`, `Stream`, `Schedule`, `Schema`, `Option`, `Redacted` and `Duration`, plus `field.*` settings, `poll(every, check)` and `fetchJson`, so a package needs no `effect` dependency of its own. Community packages: anything tagged `sedge-kit` on npm shows up when you ask sedge to look (`find_packages`), and installing one says plainly that sedge didn't review it. The docs explain how to publish your own.

## 0.1.1

### Patch Changes

- [`1e6f7ca`](https://github.com/sedge-hq/sedge/commit/1e6f7ca8cf86ca52efb50a7c16d497cc19b4a5c7) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - The npm pages show the logo, the diagram and working links, point at sedge.sh, and the kit and Telegram packages have READMEs of their own.

## 0.1.0

### Minor Changes

- [`101562a`](https://github.com/sedge-hq/sedge/commit/101562a30377f2f53d2dde2cd8f1c2851be417fd) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Channels and signals. A channel is how sedge and you talk (Telegram first); a signal wakes it when something happens elsewhere, with your instruction for what to do then. Ask in the TUI ("set up telegram", "tell me when my CI fails"): sedge installs the package, asks for secrets in a hidden field and keeps them in your OS keychain, and pairs your account with a one-time invite link. Channels show "typing…" while sedge works, and its messages can carry buttons and files. Write your own with `defineSignal` and `defineChannel` from `@sedge-hq/kit`.
  
  The daemon's agent now runs on pi-durable: every conversation lives in SQLite, a run cut short by a crash or restart resumes where it stopped, and an event that arrives twice is answered once. Under it all are the always-on pieces: an inbox that answers queued events together, timers the agent sets itself, memory files, an outbox with retries, and approvals for risky tool calls that you answer from your phone.

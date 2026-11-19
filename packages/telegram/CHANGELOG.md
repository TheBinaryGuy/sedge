# @sedge-hq/telegram

## 0.1.2

### Patch Changes

- [`7911183`](https://github.com/sedge-hq/sedge/commit/79111832712f12ecc90e6b76da4797eb749f7722) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Channels and signals import everything from `@sedge-hq/kit`: it hands you Effect's `Effect`, `Stream`, `Schedule`, `Schema`, `Option`, `Redacted` and `Duration`, plus `field.*` settings, `poll(every, check)` and `fetchJson`, so a package needs no `effect` dependency of its own. Community packages: anything tagged `sedge-kit` on npm shows up when you ask sedge to look (`find_packages`), and installing one says plainly that sedge didn't review it. The docs explain how to publish your own.
- Updated dependencies [[`7911183`](https://github.com/sedge-hq/sedge/commit/79111832712f12ecc90e6b76da4797eb749f7722)]:
  - @sedge-hq/kit@0.2.0

## 0.1.1

### Patch Changes

- [`1e6f7ca`](https://github.com/sedge-hq/sedge/commit/1e6f7ca8cf86ca52efb50a7c16d497cc19b4a5c7) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - The npm pages show the logo, the diagram and working links, point at sedge.sh, and the kit and Telegram packages have READMEs of their own.
- Updated dependencies [[`1e6f7ca`](https://github.com/sedge-hq/sedge/commit/1e6f7ca8cf86ca52efb50a7c16d497cc19b4a5c7)]:
  - @sedge-hq/kit@0.1.1

## 0.1.0

### Minor Changes

- [`101562a`](https://github.com/sedge-hq/sedge/commit/101562a30377f2f53d2dde2cd8f1c2851be417fd) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Channels and signals. A channel is how sedge and you talk (Telegram first); a signal wakes it when something happens elsewhere, with your instruction for what to do then. Ask in the TUI ("set up telegram", "tell me when my CI fails"): sedge installs the package, asks for secrets in a hidden field and keeps them in your OS keychain, and pairs your account with a one-time invite link. Channels show "typing…" while sedge works, and its messages can carry buttons and files. Write your own with `defineSignal` and `defineChannel` from `@sedge-hq/kit`.
  
  The daemon's agent now runs on pi-durable: every conversation lives in SQLite, a run cut short by a crash or restart resumes where it stopped, and an event that arrives twice is answered once. Under it all are the always-on pieces: an inbox that answers queued events together, timers the agent sets itself, memory files, an outbox with retries, and approvals for risky tool calls that you answer from your phone.

### Patch Changes

- Updated dependencies [[`101562a`](https://github.com/sedge-hq/sedge/commit/101562a30377f2f53d2dde2cd8f1c2851be417fd)]:
  - @sedge-hq/kit@0.1.0

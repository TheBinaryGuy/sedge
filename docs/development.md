---
title: Development
description: Run sedge from source, test it, and ship a release.
---

## Setup

[Bun](https://bun.sh) only:

```sh
bun install
bun run sedge          # the TUI from source, against ./.sedge-dev
```

`bun run sedge` keeps everything in `./.sedge-dev`, so it never touches your real `~/.sedge`.

## Before a change is done

```sh
bun run format
bun run lint
bun run typecheck
bun run test
bun run e2e:telegram   # after changing channels, signals or the daemon
```

`bun run adversarial` attacks the security and durability guarantees: prompt injection from
webhooks, laundering through approvals, buttons, `tell` and subagents, escalation through sedge's
config, credential access with the sandbox off and on, and the sandbox escape through the
daemon's socket. It runs daemons from source in throwaway homes full of decoy credentials, inside a
Seatbelt guard that keeps your real ones out of reach (macOS), and makes real model calls through
your logins; it fails when any check doesn't hold. Run it after changing permissions, the sandbox
or the inbox.

`e2e:telegram` starts a fake Telegram Bot API and a daemon in a throwaway home, then walks
install, connect, pairing, a reply, an approval and disconnect, with real model calls through
your logins. `SEDGE_BIN=dist/npm/sedge-<os>-<cpu>/bin/sedge` runs it against a compiled binary
(`bun scripts/build.ts` builds one for this machine).

`bun install` sets up a pre-push hook (`.githooks/pre-push`) that runs the same checks and refuses a
push that fails them.

The scripts run [Turborepo](https://turborepo.dev) with its anonymous telemetry turned off
(`TURBO_TELEMETRY_DISABLED=1`), here and in CI.

## The repository

| Path                | What                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `apps/cli`          | The `sedge` command: dispatch, the TUI extension and its tools, the client. |
| `apps/site`         | sedge.sh on Fumadocs: the home page, these docs, the installer.             |
| `packages/daemon`   | The daemon: connections, runtime, dispatcher, host, server, updater.        |
| `packages/agent`    | The daemon's agent on pi-durable: tools, MCP, skills, recall.               |
| `packages/db`       | Inbox, timers, outbox, approvals (SQLite, Drizzle).                         |
| `packages/protocol` | The RPCs between the TUI and the daemon.                                    |
| `packages/core`     | Paths, config, version, logo.                                               |
| `packages/config`   | Shared formatter, lint and TypeScript settings.                             |
| `packages/kit`      | [`@sedge-hq/kit`](./kit.md), published.                                     |
| `packages/telegram` | `@sedge-hq/telegram`, the reference channel, published.                     |
| `packages/slack`    | `@sedge-hq/slack`, published.                                               |
| `packages/github`   | `@sedge-hq/github`: CI failures, reviews and mentions, published.           |
| `packages/web`      | `@sedge-hq/web`: page changes and feeds, published.                         |
| `packages/local`    | `@sedge-hq/local`: webhook, files and command signals, published.           |
| `packages/mqtt`     | `@sedge-hq/mqtt`, published.                                                |
| `docs`              | These pages.                                                                |
| `scripts`           | Build, release, and the generated pictures (`logo.ts`, `architecture.ts`).  |

[`AGENTS.md`](https://github.com/sedge-hq/sedge/blob/main/AGENTS.md) has the rules the code follows.

## Docs

A change people would notice updates these pages in the same change. `bun run test` fails when a
command, tool, setting or environment variable is missing from [Commands](./commands.md) or
[Configuration](./configuration.md).

## Screenshots

The screenshots in these pages are drawn, not captured: `bun scripts/screenshots.ts` runs the
real `sedge dash` and TUI from source, with sample data in a throwaway home, in a terminal nobody
sees, and writes each screen to `docs/screenshots/` as SVG. Run it after changing what they show.

## The site

sedge.sh is `apps/site`: [Fumadocs](https://fumadocs.dev) on Next.js, exported as static files
and served by a Cloudflare Worker that also hands `curl sedge.sh` the installer. The docs pages
are this folder, copied in at build time, so GitHub and the site always show the same text.

```sh
cd apps/site
bun run dev       # the site with hot reload
bun run preview   # the built site through the Worker
```

Pushing to `main` deploys it: Cloudflare Workers Builds builds `apps/site` from the repository.

## Releases

Every user-facing change has a changeset (`bun run changeset`). Merging to `main` opens or updates
a release PR; merging that publishes to npm, tags the version and creates a GitHub release whose
notes link each change's commit and PR.

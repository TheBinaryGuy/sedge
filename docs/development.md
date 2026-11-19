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

`e2e:telegram` starts a fake Telegram Bot API and a daemon in a throwaway home, then walks
install, connect, pairing, a reply, an approval and disconnect, with real model calls through
your logins. `SEDGE_BIN=dist/npm/sedge-<os>-<cpu>/bin/sedge` runs it against a compiled binary
(`bun scripts/build.ts` builds one for this machine).

## The repository

| Path                | What                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `apps/cli`          | The `sedge` command: dispatch, the TUI extension and its tools, the client. |
| `apps/site`         | sedge.sh: the page and the `curl … \| sh` installer.                        |
| `packages/daemon`   | The daemon: connections, runtime, dispatcher, host, server, updater.        |
| `packages/agent`    | The daemon's agent on pi-durable: tools, MCP, skills, recall.               |
| `packages/db`       | Inbox, timers, outbox, approvals (SQLite, Drizzle).                         |
| `packages/protocol` | The RPCs between the TUI and the daemon.                                    |
| `packages/core`     | Paths, config, version, logo.                                               |
| `packages/kit`      | [`@sedge-hq/kit`](./kit.md), published.                                     |
| `packages/telegram` | `@sedge-hq/telegram`, published.                                            |
| `docs`              | These pages.                                                                |
| `scripts`           | Build, release, and the generated pictures (`logo.ts`, `architecture.ts`).  |

[`AGENTS.md`](https://github.com/sedge-hq/sedge/blob/main/AGENTS.md) has the rules the code follows.

## Docs

A change people would notice updates these pages in the same change. `bun run test` fails when a
command, tool, setting or environment variable is missing from [Commands](./commands.md) or
[Configuration](./configuration.md).

## Releases

Every user-facing change has a changeset (`bun run changeset`). Merging to `main` opens or updates
a release PR; merging that publishes to npm, tags the version and creates a GitHub release whose
notes link each change's commit and PR.

<p align="center"><img src="docs/logo.svg" width="72" alt="sedge logo: a tuft of sedge in green pixels"></p>

<h1 align="center">sedge</h1>

An always-on agent that lives on your machine. The chat is [pi](https://github.com/earendil-works/pi),
exactly: same TUI, same `/` commands, same providers and extensions. Behind it runs a small daemon
that keeps an inbox, fires timers and keeps working after you close the terminal.

```sh
npm i -g sedge          # or: curl -fsSL https://raw.githubusercontent.com/TheBinaryGuy/sedge/main/scripts/install.sh | sh

sedge                   # pi's TUI; starts the daemon first if it isn't running
sedge -p "summarize ./notes"   # print mode, like pi -p
sedge start [--service] # make sure the daemon runs; --service also starts it at login
sedge stop              # stop it (and remove the login service)
sedge update            # update sedge; `sedge update --extensions` updates pi packages
```

pi's own commands live under `sedge pi`: `sedge pi install <pkg>`, `sedge pi mcp add …`,
`sedge pi update --extensions`, `sedge pi --help`. pi's flags (`--model`, `--continue`, `--resume`,
…) work on `sedge` and `sedge -p` as they do on pi. Credentials, models, MCP
servers and extensions come from pi's agent directory (`~/.pi/agent`), so `/login` once and both
`pi` and `sedge` use it.

Subagents work the pi way: install a subagent extension (pi ships one in its examples) and each
subagent runs as its own `sedge -p` process. Inside the TUI, `/sedge` shows the daemon, `/sedge bg <task>` hands a task to it, and when
background work (a timer, a `bg` task) finishes, a note appears in the chat.

## How it fits together

```
sedge (TUI)  ── pi's InteractiveMode, in process ──┐
   └─ Sedge pi extension ── Effect RPC over ~/.sedge/sedge.sock ──► daemon
                                                                     ├─ inbox (SQLite) ─► one worker ─► pi session per cwd
                                                                     ├─ timers (cron) ─► inbox
                                                                     └─ updater (npm registry, every 6h)
```

- **One daemon**, held by `~/.sedge/daemon.lock`. Every client starts it if it's missing and
  replaces it if it's a different version or speaks a different protocol.
- **The inbox** is the only way work reaches the daemon's agent. One worker drains it in order, so
  runs never compete for a session, and items survive a crash (they're requeued on start).
- **No pi install needed**: pi is compiled into the `sedge` binary.
- **Updates** install in the background and apply when the agent is idle: npm/bun/pnpm installs
  update through their package manager, the standalone install replaces `~/.sedge/bin` after
  checking the registry's sha512. `SEDGE_NO_UPDATE=1` turns automatic installs off.

## Repository

| Path                | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/cli`          | The `sedge` package: dispatch, the daemon client, the Sedge pi extension |
| `packages/daemon`   | Lock, inbox worker, timers, RPC server, updater, launchd/systemd service |
| `packages/agent`    | pi sessions for background runs (MCP, codemode, tool search loaded)      |
| `packages/db`       | Drizzle schema and migrations on Effect's Bun SQLite client              |
| `packages/protocol` | The client–daemon RPC contract                                           |
| `packages/core`     | Paths, version, process helpers                                          |
| `packages/config`   | Shared tsconfig, oxlint and oxfmt settings                               |

```sh
bun install
bun run sedge           # run from source against ./.sedge-dev, never your real ~/.sedge
bun run check           # lint, format check, typecheck
bun run test
bun run build           # compile this platform's binary into dist/npm
```

## Releasing

Changes that ship get a changeset (`bun run changeset`). On `main`, the release workflow keeps a
"Version Packages" PR open; merging it compiles all five platforms, publishes `sedge-<os>-<cpu>`
and then `sedge` to npm with provenance, tags `v<version>` and creates a GitHub release.

Before the first release: add an `NPM_TOKEN` secret (an npm automation token) so the workflow can
create the packages. Once they exist you can switch each to npm trusted publishing and drop the
token.

## License

MIT

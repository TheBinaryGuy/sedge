<p align="center"><img src="docs/logo.svg" width="72" alt="sedge logo"></p>

<h1 align="center">sedge</h1>

<p align="center">An always-on agent that lives on your machine, built on <a href="https://github.com/earendil-works/pi">pi</a>.</p>

```sh
npm i -g @sedge-hq/sedge
```

```sh
sedge                  # the TUI
sedge -p "…"           # one reply, then exit
sedge start --service  # keep the daemon running across logins
sedge stop
sedge update
sedge pi …             # pi's own commands (install, mcp, config, …)
```

`sedge` is pi's TUI, with a daemon behind it that keeps working after you close the terminal:
it holds an inbox, fires timers, and updates itself. pi comes bundled; credentials and extensions
are pi's (`~/.pi/agent`).

## Develop

```sh
bun install
bun run sedge   # from source, against ./.sedge-dev
bun run check   # lint, format, typecheck
bun run test
```

Releases go out through changesets: `bun run changeset`, merge the release PR.

MIT

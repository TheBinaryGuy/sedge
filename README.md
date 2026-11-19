<p align="center"><img src="docs/logo.svg" width="72" alt="sedge logo"></p>

<h1 align="center">sedge</h1>

<p align="center">An always-on agent that lives on your machine, built on <a href="https://github.com/earendil-works/pi">pi</a>.</p>

<p align="center">
  <a href="https://github.com/sedge-hq/sedge/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/sedge-hq/sedge/ci.yml?branch=main&label=ci"></a>
  <a href="https://www.npmjs.com/package/@sedge-hq/sedge"><img alt="npm" src="https://img.shields.io/npm/v/@sedge-hq/sedge?label=npm"></a>
  <a href="https://github.com/sedge-hq/sedge/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/sedge-hq/sedge?label=release"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/sedge-hq/sedge"></a>
</p>

```sh
curl -fsSL sedge.sh | sh      # or: npm i -g @sedge-hq/sedge
```

```sh
sedge                  # the TUI
sedge -p "…"           # one reply, then exit
sedge start --service  # keep the daemon running across logins
sedge stop
sedge update
sedge pi …             # pi's own commands (install, mcp, config, …)
```

Reach it from your phone: in `sedge`, say "set up telegram". Sources like Telegram are packages
(`sedge install telegram`), and you can ask sedge to write one for anything else.

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

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
sedge pi …             # the agent's own commands (packages, mcp, config, …)
```

Reach it from your phone: in `sedge`, say "set up telegram". It asks for the bot token in a
hidden field, keeps it in your keychain, and gives you a link that pairs your account.

**Channels** are how you and sedge talk (Telegram). **Signals** wake it when something happens
elsewhere, and you say what it should do then: "tell me when my CI fails". Both come as packages
(`sedge install telegram`), and sedge can write a signal for anything else
([`@sedge-hq/kit`](packages/kit)).

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "ui-monospace, monospace", "primaryColor": "#f4f7ef", "primaryBorderColor": "#4f7a28", "primaryTextColor": "#1f2a14", "lineColor": "#6b8f47", "clusterBkg": "#fbfcf8", "clusterBorder": "#a9c08c"}}}%%
flowchart LR
    phone["Telegram<br/>on your phone"]
    world["CI, feeds,<br/>anything"]
    tui["sedge<br/>the TUI"]

    subgraph daemon ["sedge daemon"]
        direction LR
        channels["channels"]
        signals["signals"]
        timers["timers"]
        inbox[("inbox")]
        agent["agent<br/>pi-durable"]
        memory[("memory")]
        approvals["approvals"]
        outbox[("outbox")]
    end

    phone <-->|"paired by invite link"| channels
    world --> signals
    tui -->|"RPC, Unix socket"| inbox
    channels --> inbox
    signals --> inbox
    timers --> inbox
    inbox -->|"one run per conversation"| agent
    memory --> agent
    agent -->|"set_timer"| timers
    agent -->|"risky tool call"| approvals
    approvals --> outbox
    agent -->|"send_message"| outbox
    outbox -->|"retries"| channels

    classDef outside fill:#1f2a14,stroke:#1f2a14,color:#f4f7ef
    classDef store fill:#dfe9cf,stroke:#4f7a28,color:#1f2a14
    class phone,world,tui outside
    class inbox,memory,outbox store
```

Behind the TUI, a daemon keeps working after you close the terminal: an inbox of events, timers
it sets itself, memory, approvals you answer from your phone, and updates. Its conversations are
durable ([pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable)): a run a
restart cuts short picks up where it stopped. The agent is [pi](https://github.com/earendil-works/pi),
bundled; your logins are in `~/.pi/agent`.

## Develop

```sh
bun install
bun run sedge   # from source, against ./.sedge-dev
bun run check   # lint, format, typecheck
bun run test
bun run e2e:telegram   # the whole Telegram path, against a fake Bot API
```

Releases go out through changesets: `bun run changeset`, merge the release PR.

MIT

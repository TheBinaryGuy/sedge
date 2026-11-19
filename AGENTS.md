# Development

- Bun only (`bun install`, `bun run …`, `bunx`); never npm or pnpm in this repo.
- Before finishing a change, run `bun run format`, `bun run lint`, `bun run typecheck` and
  `bun run test`, and fix what they report.
- Never commit or push unless asked in the current request.
- Commit messages follow Conventional Commits: `type(scope): summary`, imperative, lowercase, no
  trailing period. Scopes are the package (`cli`, `daemon`, `agent`, `db`, `protocol`, `core`) or
  area (`release`, `ci`).
- Anything that changes what users get needs a changeset (`bun run changeset`), describing the
  change for the `sedge` package.
- Four spaces. Oxfmt owns formatting; Oxlint owns linting.
- Tests are Vitest on Bun (`bun --bun vitest`), with `@effect/vitest` for Effect code. Every test
  must fail on a defect a user would notice; no tests that only check a mock returned its input.
- Use `bun run sedge` to try changes: it points `SEDGE_HOME` at `./.sedge-dev`.

# Structure

- `apps/cli/src/main.ts` only dispatches, and imports nothing heavy: `sedge` and `sedge -p` run
  pi's `main()` with the Sedge extension (`pi.ts`), `start|stop|update` are Effect CLI commands
  (`commands.ts`), and `sedge pi …` is pi's own CLI. Keep pi out of the paths that don't need it;
  it takes about a second to load. Load pi only through `load-pi.ts`.
- The TUI never waits for the daemon: `sedge` starts it in the background and the extension
  connects when the socket is up.
- pi's interactive session lives in the TUI process. The daemon's agent is pi-durable
  (`packages/agent`): one durable conversation per thread ("main" is the root) in
  `~/.sedge/agent/durable.sqlite`, with your pi logins and default model. Inbox items are submitted
  with their id as the request id, so a repeat is answered once. pi-durable is experimental: keep
  its packages pinned to one exact version, matching pi's.
- The client and daemon talk only through `packages/protocol` (Effect RPC, NDJSON over a Unix
  socket). Adding or removing an RPC changes `PROTOCOL`, which makes clients replace older daemons.
- The daemon follows the always-on primitives: events go into the inbox (`packages/db`), one
  worker drains it per thread (`runtime.ts`), timers fire into it, memory lives in
  `~/.sedge/memory` and is loaded by `host.ts`, risky tool calls are deferred to approvals, and
  everything the user is told goes through the outbox and `dispatcher.ts`.
- Channels (talk with the user) and signals (wake the agent) are connections
  (`packages/daemon/src/connections.ts`): config entries of a kind from an installed package
  (`"sedge": { "plugins": … }` in its package.json) or a registered module in `~/.sedge/kinds`.
  Kinds are bundled before loading: a compiled binary can't resolve npm packages for modules from
  disk. Secrets go to the OS keychain (`secrets.ts`); the config only names them. Channels pair
  accounts through one-time invite links. The public contract is `@sedge-hq/kit` (`defineChannel`,
  `defineSignal`); `@sedge-hq/telegram` is the reference channel.
- `bun run e2e:telegram` walks install, connect, invite pairing, a reply, an approval and
  disconnect against a fake Bot API (`SEDGE_BIN=…` for a compiled binary). Run it after changing
  channels, signals or the daemon.
- All agent work in the daemon goes through the inbox (`packages/db/src/inbox.ts`); never call the
  agent directly from an RPC handler.
- Schema changes: edit `packages/db/src/schema`, run `bun run db:generate -- --name <what>`, commit
  both the migration and `migrations.gen.ts`. Never edit a migration that has shipped.
- Write Effect code the Effect 4 way: `Context.Service` classes with static `layer`s, `Effect.fn`
  for service methods, `Schema` for anything crossing a boundary.
- The logo is `LOGO` in `packages/core/src/logo.ts`; after changing it run `bun scripts/logo.ts`
  to regenerate `docs/logo.svg`.
- The release build (`scripts/build.ts`) ships pi's assets beside the binary and a package.json
  naming the app `sedge`. If pi adds an asset or a worker entrypoint, mirror it there.

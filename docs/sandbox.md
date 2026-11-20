---
title: Sandbox
description: Run the daemon's commands in the operating system's sandbox, so they can only write where you allow and never read your credentials.
---

[Approvals](./security.md#the-permission-policy) decide whether a command runs. The sandbox
limits what it can do once it does: where it can write, what it can read, and whether it can reach
the network. It's off unless you turn it on.

## Turn it on

In `~/.sedge/config.json`:

```json
"sandbox": { "enabled": true }
```

Then restart the daemon: `sedge stop && sedge start`. The sandbox is set when the daemon starts,
so a change never applies to a run halfway through.

| Setting            | What it does                                                           | Default |
| ------------------ | ---------------------------------------------------------------------- | ------- |
| `sandbox.enabled`  | Turns it on.                                                           | off     |
| `sandbox.network`  | Whether commands may connect anywhere. `false` cuts them off entirely. | `true`  |
| `sandbox.writable` | More folders it may write to, like `["~/code", "~/notes"]`.            | none    |
| `sandbox.hidden`   | More files and folders nothing in it may read, like `["~/taxes"]`.     | none    |

## What it allows

- **Writing**: in the folder the run works in, sedge's workspace and memory, temp, the package
  caches (`~/.cache`, `~/.npm`, `~/.bun/install/cache`, `~/Library/Caches`), and the folders in
  `writable`. Anywhere else, a command fails ("Operation not permitted" on macOS, "Read-only file
  system" on Linux).
- **Reading**: everything, except what's hidden.
- **Hidden**: `~/.ssh`, `~/.aws`, `~/.azure`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc`,
  `~/.npmrc`, `~/.git-credentials`, `~/.config/git/credentials`, `~/.config/gh`,
  `~/.config/gcloud`, your pi logins and MCP sign-ins (`~/.pi/agent/auth.json`, `mcp-auth.json`,
  or `SEDGE_AGENT_DIR`'s), `~/Library/Keychains`, all of sedge's own files (everything in
  `~/.sedge` but the memory and the workspace: config, secrets, database, conversations, logs),
  and what you list in `hidden`. Anything else holding a credential (a `.env` file, another tool's
  login) isn't hidden unless you list it. A hidden path can't be read or listed, a link that leads
  into one is hidden too, and `send_message` won't attach one.
- **sedge's socket**: a command can't connect to it, or to any socket inside a hidden path. Through
  it, a command could otherwise ask the daemon to do what the sandbox doesn't let the command do.
- **Environment**: commands get your environment without the variables named like credentials
  (`…TOKEN`, `…SECRET…`, `…PASSWORD`, `…API_KEY`, `…ACCESS_KEY`, `…PRIVATE_KEY`, `…CREDENTIAL…`,
  `…AUTH…`).
- **Network**: open unless `network` is `false`. Then commands can't connect anywhere, this machine
  included; `git push` and package installs fail, which is the point.

## How it works

Every command the daemon's agent runs goes through the operating system's sandbox:

- **macOS**: Seatbelt (`sandbox-exec`), built in.
- **Linux**: [bubblewrap](https://github.com/containers/bubblewrap). Install it first:
  `apt install bubblewrap` or `dnf install bubblewrap`. It mounts everything read-only except
  the writable folders, and puts an empty folder over each hidden one.
- **Windows**: there's no sandbox yet.

The agent's file tools (`read`, `write`, `edit`, `ls`, `find`, `grep`) don't run commands, so
sedge checks them against the same rules itself, after following links.

Where the sandbox isn't available (Windows, or Linux without bubblewrap), commands **don't run at
all** while it's on. They fail and say why, rather than running unconfined.

## What it doesn't cover

- **MCP servers**, which run as their own programs with your rights.
- **Installed packages** (channels and signals), which run inside the daemon. See
  [Code you add](./security.md#code-you-add).
- **The TUI's own chat**, which is pi's. pi has no sandbox of its own; to confine it, run it in a
  container as [pi's docs](https://github.com/earendil-works/pi) describe.
- **pi extensions** listed in `piExtensions`, which run inside the daemon.
- **A hard link made before**: a file linked to a credential while the sandbox was off stays
  readable through the link, since it's the same file under another name.
- **A command still running when the daemon is killed** keeps going; the agent is told its call
  was interrupted, and nothing runs it a second time.

## When a command is refused

The agent sees the refusal like any failed command and says what it couldn't do. If it should have
been allowed, add the folder to `writable`, or turn `network` back on, and restart the daemon.

Tools that need a hidden login fail inside it: `gh` (its login is in `~/.config/gh`), `git push`
over SSH, `npm publish`. That's the trade: the agent can't use your credentials, so it can't leak
them either. On Linux, a `writable` or `hidden` path that doesn't exist when the daemon starts is
left out until the next start.

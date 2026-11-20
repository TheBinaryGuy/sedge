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
  `writable`. Anywhere else, a command fails with "Operation not permitted".
- **Reading**: everything, except what's hidden.
- **Hidden**: `~/.ssh`, `~/.aws`, `~/.azure`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.netrc`,
  `~/.config/gh`, `~/.config/gcloud`, your pi logins (`~/.pi/agent/auth.json`),
  `~/Library/Keychains`, sedge's config and secrets, and what you list in `hidden`. A hidden path
  can't be read or listed, a link that leads into one is hidden too, and `send_message` won't
  attach one.
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

## When a command is refused

The agent sees the refusal like any failed command and says what it couldn't do. If it should have
been allowed, add the folder to `writable`, or turn `network` back on, and restart the daemon.

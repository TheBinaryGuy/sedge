---
title: Channels and signals
description: Talk to sedge from Telegram, and wake it when something happens elsewhere.
---

- A **channel** is a conversation between you and sedge: Telegram today, others as packages.
  Your messages wake it; its answers and questions come back there.
- A **signal** is something happening elsewhere: CI failed, a feed changed, a price moved. It
  wakes sedge with your instruction for what to do then.

Both are connected the same way, and both come in **kinds** that packages provide.

## Connect one

Ask in the TUI, in your own words:

> set up telegram
>
> tell me when the CI on main fails

sedge finds or installs the kind, shows you what it will connect, and asks for any secret
(a token, a password) in a hidden field. Secrets go to your OS keychain (macOS Keychain,
libsecret on Linux, Windows Credential Manager); the config file only names them. Where there's
no keychain, an owner-only file in `~/.sedge` stands in.

The tools it uses, if you want to ask for them by name: `channels`, `signals`,
`find_packages`, `install`, `connect`, `disconnect`, `invite`, `create_signal`. See [Commands](./commands.md).

## Pairing a channel

A channel answers only accounts you paired. Connecting one gives you an **invite** with a one-time
code: on Telegram a link (`https://t.me/<your bot>?start=<code>`) to open on your phone; on Slack
a message to send the bot (`pair <code>`). That account is paired, and the code is spent. Codes expire after 30 minutes. Anyone else who writes to your
bot, with or without a code, gets no answer at all.

To pair another account, or after a link expired, ask for a new invite (`invite` tool).

## What a channel can do

- **Typing**: while sedge works on your message, the channel shows it (Telegram's "typing…").
- **Formatting**: messages are Markdown, rendered as far as the channel can.
- **Choices**: a message can carry buttons. Your pick comes back to sedge as an event. Approvals
  use this: Approve / Deny.
- **Files**: sedge can attach files from your machine.

Answers go to the channel and chat you last wrote from.

## Signals

A signal reports what happened as data, never as instructions: text inside a CI log that says
"ignore your instructions" stays text. sedge reads the event together with the instruction you
gave when connecting it ("tell me if it's my commit", "retry once, then tell me"). Signals report
into the `main` conversation, so a follow-up question on Telegram has the context.

## Kinds

| Kind        | Type    | Package                                                                                                                        |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `telegram`  | channel | [`@sedge-hq/telegram`](https://github.com/sedge-hq/sedge/blob/main/packages/telegram)                                          |
| `slack`     | channel | [`@sedge-hq/slack`](https://github.com/sedge-hq/sedge/blob/main/packages/slack)                                                |
| `github-ci` | signal  | [`@sedge-hq/github`](https://github.com/sedge-hq/sedge/blob/main/packages/github): Actions runs that fail                      |
| `github`    | signal  | [`@sedge-hq/github`](https://github.com/sedge-hq/sedge/blob/main/packages/github): reviews asked of you, assignments, mentions |
| `web-page`  | signal  | [`@sedge-hq/web`](https://github.com/sedge-hq/sedge/blob/main/packages/web): a page whose text changes                         |
| `feed`      | signal  | [`@sedge-hq/web`](https://github.com/sedge-hq/sedge/blob/main/packages/web): new posts on an RSS or Atom feed                  |

Install a package with `sedge install <name>` (a short name means `@sedge-hq/<name>`), a full npm
name, or the path of a package folder. A folder is packed the way it would be published, along
with the workspace packages it depends on, so you can try a package before it's on npm.

## Slack

Slack connects with Socket Mode, so nothing has to be reachable from the internet. It needs a
Slack app of your own with two tokens; the
[`@sedge-hq/slack` README](https://github.com/sedge-hq/sedge/blob/main/packages/slack) walks
through making one in a few minutes. Then say "set up slack".

## Community packages

Anyone can publish channels and signals. Ask sedge to look ("is there a Slack channel?") and it
searches npm for packages tagged `sedge-kit` (`find_packages`), showing who published each. Install
one by its npm name, or straight from a repository:

```sh
sedge install sedge-slack
sedge install github:someone/sedge-rss
```

A community package's code runs inside the daemon with your rights, and sedge didn't write or
review it: `install` says so and links the package before you confirm. Read it first.

## Your own

When nothing fits, ask sedge to write one: "make a signal for new issues in my repo". It writes a
module with [`@sedge-hq/kit`](./kit.md), you review it, and `create_signal` registers it. Its code
runs inside the daemon with your rights, so read it before you say yes.

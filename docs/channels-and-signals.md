---
title: Channels and signals
description: Talk to sedge from Telegram or Slack, and wake it when something happens elsewhere.
---

- A **channel** is a conversation between you and sedge: Telegram, Slack, or whatever else you can imagine.
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
`find_packages`, `install`, `uninstall`, `connect`, `disconnect`, `invite`, `create_signal`. See [Commands](./commands.md).

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

### Filtering, throttling and triage

A signal can fire more than you care about. These settings on any signal decide what reaches the
agent, so a noisy one doesn't start a model run for each event. They apply in this order:

- **`match`**: only events whose text matches this regular expression (any case), like
  `fail|error`.
- **`ignore`**: drop events that match this one, like `dependabot`.
- **`when`**: only events whose details meet a condition, written the way you'd say it:
  `temperature > 30 and room = kitchen`, `payload.moisture < 30`, `status != ok or retries >= 3`.
  A field is a path into what the signal reports (the `mqtt` signal reports `topic` and `payload`,
  `webhook` reports `path` and `body`); `text` is the event's text. Operators are `=`, `!=`, `>`,
  `>=`, `<`, `<=` and `contains`; `and` binds tighter than `or`. A number sent as text still
  compares as a number, and an event without the field doesn't get through.
- **`throttle`**: after an event gets through, drop the next ones for this long (`10m`, `1h`): one
  message about the alarm, not one a minute. The time is kept, so a restart doesn't cut it short.
- **`batch`**: hold events this long after the first (`30s`, `5m`, `1h`) and hand them over
  together, in one run. Held events are kept in the inbox, so a restart doesn't lose them, and
  anything else that wakes the same agent first takes them along.
- **`triage`**: before the events wake the agent, a cheap model reads them with your instruction
  and decides whether they need it. When it says no, the agent sleeps on and the inbox shows why
  ("Skipped by triage: the soil is still moist"). It costs one small call per event (or batch), far
  less than a run. It uses the cheapest model of the provider you're logged in with, or the one
  you name in [`triageModel`](./configuration.md). When it isn't sure, or can't run, the agent
  wakes, so nothing is missed. Events that come with a message from you are never triaged.

The rules (`match`, `ignore`, `when`) cost nothing and are exact; triage understands what you meant
("only if it's my commit") at a small price. Use the rules when you can say it as one, and triage
when you can't.

Say it when connecting ("tell me if the kitchen goes above 30, at most once an hour"), or change it
later ("stop telling me about dependabot"): the TUI's agent sets these with `connect` and
`update_signal`, and you confirm.

## Kinds

| Kind        | Type    | Package                                                                                                                        |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `telegram`  | channel | [`@sedge-hq/telegram`](https://github.com/sedge-hq/sedge/blob/main/packages/telegram)                                          |
| `slack`     | channel | [`@sedge-hq/slack`](https://github.com/sedge-hq/sedge/blob/main/packages/slack)                                                |
| `github-ci` | signal  | [`@sedge-hq/github`](https://github.com/sedge-hq/sedge/blob/main/packages/github): Actions runs that fail                      |
| `github`    | signal  | [`@sedge-hq/github`](https://github.com/sedge-hq/sedge/blob/main/packages/github): reviews asked of you, assignments, mentions |
| `web-page`  | signal  | [`@sedge-hq/web`](https://github.com/sedge-hq/sedge/blob/main/packages/web): a page whose text changes                         |
| `feed`      | signal  | [`@sedge-hq/web`](https://github.com/sedge-hq/sedge/blob/main/packages/web): new posts on an RSS or Atom feed                  |
| `webhook`   | signal  | [`@sedge-hq/local`](https://github.com/sedge-hq/sedge/blob/main/packages/local): HTTP POSTs to a local address                 |
| `files`     | signal  | [`@sedge-hq/local`](https://github.com/sedge-hq/sedge/blob/main/packages/local): files created, changed or removed in a folder |
| `command`   | signal  | [`@sedge-hq/local`](https://github.com/sedge-hq/sedge/blob/main/packages/local): what a shell command prints                   |
| `mqtt`      | signal  | [`@sedge-hq/mqtt`](https://github.com/sedge-hq/sedge/blob/main/packages/mqtt): messages on MQTT topics                         |

Install a package with `sedge install <name>` (a short name means `@sedge-hq/<name>`), a full npm
name, or the path of a package folder. A folder is packed the way it would be published, along
with the workspace packages it depends on, so you can try a package before it's on npm.

To remove one, disconnect what uses it, then `sedge uninstall <name>`.

## Webhooks, files and commands

`@sedge-hq/local` covers what happens on your machine or can reach it:

- **`webhook`** listens on `http://127.0.0.1:4747` (change `port` and `host`), and each POST is an
  event. Senders give the token you chose, as `Authorization: Bearer <token>`, as `?token=<token>`,
  or as a GitHub webhook secret. A delivery id header (`X-GitHub-Delivery`, `X-Request-Id`,
  `Idempotency-Key`) drops a retried delivery. It only listens on this machine unless you set
  `host`; to receive from outside, put a tunnel in front of it.
- **`files`** looks at a folder (or one file) every 10 seconds and reports what was created,
  changed or removed, optionally only files matching a `pattern` like `**/*.csv`.
- **`command`** runs a shell command. A long-running one (`tail -n0 -f app.log`,
  `mosquitto_sub -t sensors/#`) reports each burst of lines it prints, and is started again if
  it exits. With `minutes`, it runs on a schedule instead and reports when its output changes
  (`df -h /`, `systemctl is-active api`). Anything a command can read becomes a signal this way:
  sensors, queues, MQTT topics, a service's status.

## MQTT

Sensors, home hubs and devices often publish to an MQTT broker (Mosquitto, Home Assistant's,
EMQX, HiveMQ). The `mqtt` signal subscribes to the topics you give it, with `+` and `#`
wildcards (`home/+/soil`, `sensors/#`), and each message is an event: its topic, and what was
sent, with JSON laid out. The broker can be `mqtt://`, `mqtts://` (TLS) or `wss://` (WebSocket);
a password goes to the keychain like any secret.

Each message's details are its `topic` and `payload`, with JSON as values, so a condition can
read a field: `payload.moisture < 30`. It keeps a session on the broker, so messages sent while
sedge was stopped arrive when it's back. A topic's retained value, which brokers send again on
every subscribe, isn't reported. Sensors publish often, so a `when` and a `throttle` are usually
worth setting: "tell me when the basil's soil is dry, at most once an hour".

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

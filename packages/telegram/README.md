# @sedge-hq/telegram

Telegram for [sedge](https://sedge.sh): message your agent from anywhere, and it answers there.

In `sedge`, say "set up telegram". It installs this package, asks for your bot token in a hidden
field (create a bot with [@BotFather](https://t.me/BotFather)), keeps it in your keychain, and
gives you a one-time link that pairs your Telegram account. Nobody else gets answers.

Or by hand: `sedge install telegram`.

It shows "typing…" while sedge works, renders its Markdown, turns choices into buttons (approve
or deny a risky command from your phone) and sends files. See
[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md).

MIT

# @sedge-hq/local

What happens on your machine, for [sedge](https://sedge.sh), the always-on agent. Three signals:

- **`webhook`**: each HTTP POST to a local address (default `http://127.0.0.1:4747`) is an event.
  Senders give the token you chose, as `Authorization: Bearer <token>`, `?token=<token>`, or a
  GitHub webhook secret. A deploy hook, a home sensor, a form, any service that sends webhooks.
- **`files`**: files created, changed or removed in a folder (or one file), optionally only
  those matching a glob like `**/*.csv`.
- **`command`**: a shell command. A long-running one (`tail -n0 -f app.log`,
  `mosquitto_sub -t sensors/#`) reports each burst of lines it prints; with `minutes`, it runs on
  a schedule and reports when its output changes.

In `sedge`, say "tell me when a CSV lands in ~/Downloads/reports", "wake me when the deploy
webhook fires and the site is down", or "watch the soil sensor's MQTT topic and tell me when the
basil is dry".

A webhook's details are its `path` and `body` (JSON as values), so a condition like
`body.status = failed` can pick the deliveries that matter.

The command runs in your shell with your rights, and the webhook listens only on this machine
unless you set `host`. With sedge's [sandbox](https://github.com/sedge-hq/sedge/blob/main/docs/sandbox.md)
on, the agent's own commands are confined; the `command` signal's command is yours, and runs as you
wrote it.

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

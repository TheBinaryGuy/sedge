# @sedge-hq/mqtt

MQTT for [sedge](https://sedge.sh), the always-on agent. One signal, **`mqtt`**: it subscribes to
topics on your broker (Mosquitto, Home Assistant's, EMQX, HiveMQ), with `+` and `#` wildcards, and
each message wakes sedge with its topic and payload.

- `mqtt://`, `mqtts://` (TLS) and `wss://` (WebSocket) brokers; a password goes to your keychain.
- A session kept on the broker: messages sent while sedge was stopped arrive when it's back.
- Retained values, sent again on every subscribe, aren't reported.

In `sedge`, say "tell me when the basil's soil sensor on home/basil/soil reads dry, at most every
hour". sedge's `match`, `ignore` and `batch` settings keep a chatty sensor from waking it for every
reading.

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

# @sedge-hq/mqtt

MQTT for [sedge](https://sedge.sh), the always-on agent. One signal, **`mqtt`**: it subscribes to
topics on your broker (Mosquitto, Home Assistant's, EMQX, HiveMQ), with `+` and `#` wildcards, and
each message wakes sedge with its topic and payload.

- `mqtt://`, `mqtts://` (TLS) and `wss://` (WebSocket) brokers; a password goes to your keychain.
- A session kept on the broker: messages sent while sedge was stopped arrive when it's back.
- Retained values, sent again on every subscribe, aren't reported.

Each message's details are its `topic` and `payload`, with JSON as values, so a condition can read
a field. In `sedge`, say "tell me when the basil's soil sensor on home/basil/soil reads dry, at most
once an hour": that's `when: payload.moisture < 30` and `throttle: 1h`, so a chatty sensor doesn't
wake it for every reading.

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

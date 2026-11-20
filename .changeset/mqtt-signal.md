---
'@sedge-hq/mqtt': minor
---

New package with an `mqtt` signal: it subscribes to topics on your MQTT broker, with wildcards,
and each message wakes sedge with its topic and payload. It keeps a session on the broker, so
messages sent while sedge was stopped still arrive, and it skips retained values.

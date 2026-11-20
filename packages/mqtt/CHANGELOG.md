# @sedge-hq/mqtt

## 0.1.0

### Minor Changes

- [`6578312`](https://github.com/sedge-hq/sedge/commit/65783129c655d5296ae08b5c99c3dae0b027dcb1) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - New package with an `mqtt` signal: it subscribes to topics on your MQTT broker, with wildcards,
  and each message wakes sedge with its topic and payload. It keeps a session on the broker, so
  messages sent while sedge was stopped still arrive, and it skips retained values.

### Patch Changes

- Updated dependencies [[`6578312`](https://github.com/sedge-hq/sedge/commit/65783129c655d5296ae08b5c99c3dae0b027dcb1)]:
  - @sedge-hq/kit@0.3.2

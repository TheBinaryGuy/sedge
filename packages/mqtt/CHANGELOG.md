# @sedge-hq/mqtt

## 0.2.1

### Patch Changes

- [`ddceba7`](https://github.com/sedge-hq/sedge/commit/ddceba756e262824740f5827d20e84fceb62ecf4) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - Updated READMEs: each package's settings, the details its events carry for sedge's `when`
  conditions, and in the kit, optional secrets and putting a happening's data in `details`.
- Updated dependencies [[`ddceba7`](https://github.com/sedge-hq/sedge/commit/ddceba756e262824740f5827d20e84fceb62ecf4)]:
  - @sedge-hq/kit@0.3.3

## 0.2.0

### Minor Changes

- [`41c898a`](https://github.com/sedge-hq/sedge/commit/41c898a804b1d159d11c9edc3461637b2505da96) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - `mqtt` and `webhook` events carry their data as details (`topic` and `payload`, `path` and `body`,
  with JSON as values), so a signal's `when` condition can read a field like `payload.moisture`.

## 0.1.0

### Minor Changes

- [`6578312`](https://github.com/sedge-hq/sedge/commit/65783129c655d5296ae08b5c99c3dae0b027dcb1) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - New package with an `mqtt` signal: it subscribes to topics on your MQTT broker, with wildcards,
  and each message wakes sedge with its topic and payload. It keeps a session on the broker, so
  messages sent while sedge was stopped still arrive, and it skips retained values.

### Patch Changes

- Updated dependencies [[`6578312`](https://github.com/sedge-hq/sedge/commit/65783129c655d5296ae08b5c99c3dae0b027dcb1)]:
  - @sedge-hq/kit@0.3.2

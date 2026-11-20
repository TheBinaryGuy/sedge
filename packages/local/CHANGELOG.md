# @sedge-hq/local

## 0.1.2

### Patch Changes

- [`fe0ac6f`](https://github.com/sedge-hq/sedge/commit/fe0ac6f360c70f4673c7016f674cbe46033d643a) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - The `command` signal reports lines a command prints together as one event, whatever way the
  system splits its output: it waits for a quarter-second pause, or 200 lines, before reporting.

## 0.1.1

### Patch Changes

- Updated dependencies [[`6578312`](https://github.com/sedge-hq/sedge/commit/65783129c655d5296ae08b5c99c3dae0b027dcb1)]:
  - @sedge-hq/kit@0.3.2

## 0.1.0

### Minor Changes

- [`cab6c2d`](https://github.com/sedge-hq/sedge/commit/cab6c2d47ec5869af4310ce2822d6c28d6fc8c3b) Thanks [@TheBinaryGuy](https://github.com/TheBinaryGuy)! - New package of signals for what happens on your machine: `webhook` (HTTP POSTs to a local
  address, with a token), `files` (files created, changed or removed in a folder) and `command`
  (what a long-running shell command prints, or a change in what one prints on a schedule).

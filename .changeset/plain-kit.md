---
'@sedge-hq/kit': minor
'@sedge-hq/telegram': minor
'@sedge-hq/sedge': patch
---

`@sedge-hq/kit` is plain TypeScript now: a signal is `every` plus an `async check` (or an async generator for sources that push), a channel is an `async connect` returning plain functions, and secrets arrive as strings. Effect still runs everything underneath (settings decoding, retries, clean stops), and failures now retry with exponential, jittered backoff from 2 seconds to 5 minutes, saying when in the status line. The Effect API moves to `@sedge-hq/kit/effect`. Telegram is rewritten on the plain API, as the example to copy.

---
title: The kit
description: Write your own channel or signal with @sedge-hq/kit.
---

[`@sedge-hq/kit`](https://github.com/sedge-hq/sedge/blob/main/packages/kit) is how channels and signals are written. It's
[Effect](https://effect.website): settings are an Effect `Schema`, a signal is a `Stream`, a
channel is a scoped `Effect`.

A module's default export is a kind: `defineSignal(...)` or `defineChannel(...)`. Ship it in a
package (list the module under `"sedge": { "plugins": ["./src/my-kind.ts"] }` in package.json),
or register a single file with `create_signal`. Modules are bundled with their dependencies
before sedge loads them.

## A signal

```ts
import { defineSignal, secret } from '@sedge-hq/kit';
import { Effect, Redacted, Schedule, Schema, Stream } from 'effect';

export default defineSignal({
    name: 'ci', // lowercase; what `connect` calls the kind
    summary: 'GitHub Actions runs that fail on a branch',
    settings: {
        repo: Schema.String.annotate({ description: 'owner/name' }),
        branch: Schema.optional(Schema.String).annotate({ description: 'Default: main' }),
        token: secret('A GitHub token that can read Actions'),
    },
    watch: (settings, kit) =>
        Stream.fromEffectSchedule(failedRuns(settings, kit), Schedule.spaced('1 minute')).pipe(
            Stream.flatMap(Stream.fromIterable),
        ),
});
```

`watch` returns a `Stream` of **happenings**:

| Field     | What                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| `text`    | What the agent reads. Short and plain: "CI failed on main: lint (run 812)".   |
| `key`     | Optional. An id for this happening; one with a key sedge has seen is dropped. |
| `details` | Optional. Anything else, as JSON, shown to the agent below the text.          |

Report what changes after the signal starts, not the state of the world at start. Use
`kit.memo` to remember what you've already seen across restarts.

## A channel

```ts
import { defineChannel, secret } from '@sedge-hq/kit';
import { Effect, Stream } from 'effect';

export default defineChannel({
    name: 'my-chat',
    summary: 'my chat app: message sedge from anywhere',
    settings: { token: secret('The bot token') },
    connect: (settings, kit) =>
        Effect.gen(function* () {
            // Log in, restore paired accounts from kit.memo, …
            return {
                incoming: messages, // Stream of Message | Picked, only from paired accounts
                deliver: (reply, to) => send(reply, to),
                invite: (code) => `https://chat.example/bot?start=${code}`,
                working: (to) => showTyping(to), // optional
            };
        }),
});
```

`connect` runs in a scope: close what you open with `Effect.acquireRelease`, and it's released
when the channel stops. If it fails, sedge retries every 10 seconds and shows why in the status.

A channel must:

- **Pair through invites.** When someone sends a code from your `invite` link, call
  `kit.claim(code, account)`. If it returns true, that account is the user's: remember it in
  `kit.memo`. Ignore everyone else completely.
- **Deliver replies.** `reply.text` is Markdown (render what you can, fall back to plain text),
  `reply.choices` are buttons (send a pick back as `{ _tag: 'Picked', from, value }`),
  `reply.files` are local paths. `to` is the `from` of the message being answered, or undefined
  for "the user's usual chat".
- **Give events a `key`** (the platform's message id), so a message redelivered after a crash is
  answered once.

[`packages/telegram`](https://github.com/sedge-hq/sedge/blob/main/packages/telegram/src/telegram.ts) is the reference channel.

## The kit

| Name                       | What                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `secret(description)`      | A secret setting: typed into a hidden field, kept in the keychain, given to you as a `Redacted` (`Redacted.value(token)`). |
| `kit.memo.get(key)`        | A small value saved across restarts (`Option<string>`).                                                                    |
| `kit.memo.set(key, v)`     | Save one.                                                                                                                  |
| `kit.status(line)`         | One line on how it's doing, shown in `channels` / `signals`.                                                               |
| `kit.claim(code, account)` | Channels: pair the account that sent this invite code.                                                                     |

Settings descriptions (`.annotate({ description })`) are what the agent and the user see when
connecting, so write them for a person.

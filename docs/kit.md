---
title: The kit
description: Write your own channel or signal with @sedge-hq/kit.
---

[`@sedge-hq/kit`](https://github.com/sedge-hq/sedge/blob/main/packages/kit) is how channels and signals are written, and the only import they need. It's
[Effect](https://effect.website) inside: settings are Schemas, a signal is a `Stream`, a channel is
a scoped `Effect`. The kit hands you the Effect pieces you use (`Effect`, `Stream`, `Schedule`,
`Schema`, `Option`, `Redacted`, `Duration`), so your package doesn't depend on `effect` itself and
always runs on the version sedge has.

A module's default export is a kind: `defineSignal(...)` or `defineChannel(...)`. Ship it in a
package (list the module under `"sedge": { "plugins": ["./src/my-kind.ts"] }` in package.json),
or register a single file with `create_signal`. Modules are bundled with their dependencies
before sedge loads them.

## A signal

```ts
import { defineSignal, Effect, fetchJson, field, poll, Redacted, secret } from '@sedge-hq/kit';

interface Runs {
    readonly workflow_runs: ReadonlyArray<{ id: number; name: string; html_url: string }>;
}

export default defineSignal({
    name: 'ci', // lowercase; what `connect` calls the kind
    summary: 'GitHub Actions runs that fail on a branch',
    settings: {
        repo: field.text('owner/name'),
        branch: field.optional(field.text('Default: main')),
        token: secret('A GitHub token that can read Actions'),
    },
    watch: ({ repo, branch = 'main', token }) =>
        poll(
            '1 minute',
            fetchJson<Runs>(
                `https://api.github.com/repos/${repo}/actions/runs?branch=${branch}&status=failure&per_page=5`,
                { headers: { authorization: `Bearer ${Redacted.value(token)}` } },
            ).pipe(
                Effect.map(({ workflow_runs }) =>
                    workflow_runs.map((run) => ({
                        text: `CI failed on ${branch}: ${run.name}`,
                        key: String(run.id), // reported once, however often it's seen
                        details: { url: run.html_url },
                    })),
                ),
            ),
        ),
});
```

`watch` returns a `Stream` of **happenings**:

| Field     | What                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| `text`    | What the agent reads. Short and plain: "CI failed on main: lint (run 812)".   |
| `key`     | Optional. An id for this happening; one with a key sedge has seen is dropped. |
| `details` | Optional. Anything else, as JSON, shown to the agent below the text.          |

`poll(every, check)` runs the check now and then every `every`, and reports what each check found.
Give every happening a `key`: sedge drops one it has already seen, so a check can simply return
everything that matches. Use `kit.memo` (the second argument of `watch`) for anything else to keep
across restarts, such as a cursor.

## A channel

```ts
import { defineChannel, Effect, secret } from '@sedge-hq/kit';

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

## Publish your own

A package is an npm package whose `package.json` lists its kinds and carries the `sedge-kit`
keyword, so `find_packages` finds it:

```json
{
    "name": "sedge-rss",
    "version": "1.0.0",
    "type": "module",
    "keywords": ["sedge-kit"],
    "sedge": { "plugins": ["./src/rss.ts"] },
    "dependencies": { "@sedge-hq/kit": "^0.1.0" }
}
```

- Ship the TypeScript source; sedge bundles each kind with its dependencies when it loads it.
- Depend on `@sedge-hq/kit` only. It gives you Effect, so your kind runs on the version sedge has.
- Try it before publishing: `sedge install ./path/to/sedge-rss` installs the folder as it would be
  published.
- Then `npm publish`, and anyone can `sedge install sedge-rss`.

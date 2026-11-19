---
title: The kit
description: Write your own channel or signal with @sedge-hq/kit.
---

[`@sedge-hq/kit`](https://github.com/sedge-hq/sedge/blob/main/packages/kit) is how channels and
signals are written: plain TypeScript, `async` functions and the values you'd expect. A module's
default export is a kind, made with `defineSignal(...)` or `defineChannel(...)`.

The kit does the hard parts for you:

- it checks settings against what you declared, and keeps secrets out of files;
- it retries what fails, backing off from 2 seconds to 5 minutes with jitter, and says why in the status line;
- it stops your code cleanly, and drops anything reported twice.

Underneath it is [Effect](https://effect.website), and
[`@sedge-hq/kit/effect`](#writing-it-with-effect) is the same kit for those who want to write
Effect themselves.

## A signal

```ts
import { defineSignal, field, secret } from '@sedge-hq/kit';

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
    every: '1 minute',
    check: async ({ repo, branch = 'main', token }, kit) => {
        const { workflow_runs } = await kit.fetchJson<Runs>(
            `https://api.github.com/repos/${repo}/actions/runs?branch=${branch}&status=failure&per_page=5`,
            { headers: { authorization: `Bearer ${token}` } },
        );
        return workflow_runs.map((run) => ({
            text: `CI failed on ${branch}: ${run.name}`,
            key: String(run.id), // reported once, however often it's seen
            details: { url: run.html_url },
        }));
    },
});
```

`check` runs now and then every `every`, and returns what it found. Each **happening** is:

| Field     | What                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| `text`    | What the agent reads. Short and plain: "CI failed on main: lint (run 812)".   |
| `key`     | Optional. An id for this happening; one with a key sedge has seen is dropped. |
| `details` | Optional. Anything else, as JSON, shown to the agent below the text.          |

Give every happening a `key`, and `check` can simply return everything that matches.

For a source that pushes instead (a socket, a stream), write `watch` as an async generator and
`yield` each happening; stop when `kit.signal` aborts:

```ts
watch: async function* ({ url }, kit) {
    for await (const line of follow(url, kit.signal)) yield { text: line };
},
```

## A channel

```ts
import { defineChannel, secret } from '@sedge-hq/kit';

export default defineChannel({
    name: 'my-chat',
    summary: 'my chat app: message sedge from anywhere',
    settings: { token: secret('The bot token') },
    connect: async ({ token }, kit) => {
        const client = await login(token, kit.signal);
        return {
            listen: async () => {
                for await (const message of client.messages()) {
                    await kit.receive({
                        type: 'message',
                        from: message.chat,
                        text: message.text,
                        key: message.id,
                    });
                }
            },
            deliver: async (reply, to) => client.send(to ?? client.me, reply.text),
            invite: (code) => `https://chat.example/bot?start=${code}`,
            working: async (to) => client.typing(to),
        };
    },
});
```

`connect` logs in and returns the connection. `listen` runs until `kit.signal` aborts. If it
throws, or `connect` does, sedge connects again with the same backoff, and the status line says
why.

A channel must:

- **Pair through invites.** When someone sends a code from your `invite` link, call
  `kit.claim(code, account)`. If it returns true, that account is the user's: remember it in
  `kit.memo`. Ignore everyone else completely.
- **Deliver replies.**
    - `reply.text` is Markdown: render it, or fall back to plain text.
    - `reply.choices` are buttons; send a pick back with `kit.receive({ type: 'picked', from, value })`.
    - `reply.files` are local paths.
    - `to` is the `from` of the message being answered, or undefined for the user's usual chat.
- **Give events a `key`** (the platform's message id), so a message redelivered after a crash is
  answered once.

[`@sedge-hq/telegram`](https://github.com/sedge-hq/sedge/blob/main/packages/telegram/src/telegram.ts)
is the reference channel, written this way.

## The kit

| Name                                                | What                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `field.text`, `.number`, `.flag`, `.list`, `.oneOf` | Settings, each with a description the user sees.                           |
| `field.optional(field)`                             | A setting that may be left out.                                            |
| `secret(description)`                               | Typed into a hidden field, kept in the keychain, given to you as a string. |
| `kit.fetchJson(url, init?)`                         | `fetch` that parses JSON and throws on anything but a 2xx.                 |
| `kit.memo.get(key)`, `.set(key, value)`             | Small values kept across restarts: a cursor, the paired accounts.          |
| `kit.status(line)`                                  | One line on how it's doing, shown in `channels` and `signals`.             |
| `kit.signal`                                        | Aborted when sedge stops it: pass it to `fetch`, check it in loops.        |
| `kit.sleep(duration)`                               | Waits (`'5 seconds'`, `'1 minute'`, or ms); ends early on stop.            |
| `kit.receive(event)`                                | Channels: hand sedge a message or a pick.                                  |
| `kit.claim(code, account)`                          | Channels: pair the account that sent this invite code.                     |

Setting descriptions are what the agent and the user see when connecting, so write them for a
person.

## Writing it with Effect

`@sedge-hq/kit/effect` is the same kit with Effect showing: settings are Schemas, a signal's
`watch` returns a `Stream`, and a channel's `connect` is a scoped `Effect`. It hands you
`Effect`, `Stream`, `Schedule`, `Schema` and friends, so your package still depends on the kit
alone and runs on the Effect version sedge has.

```ts
import { defineSignal, Effect, field, poll } from '@sedge-hq/kit/effect';

export default defineSignal({
    name: 'heartbeat',
    summary: 'a beat every few minutes',
    settings: { label: field.text('What to call it') },
    watch: ({ label }) => poll('5 minutes', Effect.succeed([{ text: `${label}: beat` }])),
});
```

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
    "dependencies": { "@sedge-hq/kit": "^0.3.0" }
}
```

- Ship the TypeScript source; sedge bundles each kind with its dependencies when it loads it.
- Depend on `@sedge-hq/kit` alone.
- Try it before publishing: `sedge install ./path/to/sedge-rss` installs the folder as it would be
  published.
- Then `npm publish`, and anyone can `sedge install sedge-rss`.

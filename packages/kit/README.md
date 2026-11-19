# @sedge-hq/kit

Write channels and signals for [sedge](https://sedge.sh), the always-on agent that lives on your
machine.

- A **channel** is how sedge and you talk: Telegram, Slack, email.
- A **signal** wakes sedge when something happens elsewhere: CI failed, a feed changed.

```ts
import { defineSignal, secret } from '@sedge-hq/kit';
import { Schedule, Schema, Stream } from 'effect';

export default defineSignal({
    name: 'ci',
    summary: 'GitHub Actions runs that fail on a branch',
    settings: {
        repo: Schema.String.annotate({ description: 'owner/name' }),
        token: secret('A GitHub token that can read Actions'),
    },
    watch: (settings, kit) =>
        Stream.fromEffectSchedule(failedRuns(settings, kit), Schedule.spaced('1 minute')).pipe(
            Stream.flatMap(Stream.fromIterable),
        ),
});
```

Settings are an [Effect](https://effect.website) Schema; `secret(...)` settings are typed into a
hidden field and kept in the OS keychain. The full guide is
[The kit](https://github.com/sedge-hq/sedge/blob/main/docs/kit.md), and
[`@sedge-hq/telegram`](https://www.npmjs.com/package/@sedge-hq/telegram) is a complete channel.

MIT

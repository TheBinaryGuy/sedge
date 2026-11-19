# @sedge-hq/kit

Write channels and signals for [sedge](https://sedge.sh), the always-on agent that lives on your
machine.

- A **channel** is how sedge and you talk: Telegram, Slack, email.
- A **signal** wakes sedge when something happens elsewhere: CI failed, a feed changed.

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

It's the only import a kind needs: [Effect](https://effect.website) is inside, and the kit hands
you the pieces you use. `secret(...)` settings are typed into a hidden field and kept in the OS
keychain. The full guide is
[The kit](https://github.com/sedge-hq/sedge/blob/main/docs/kit.md), and
[`@sedge-hq/telegram`](https://www.npmjs.com/package/@sedge-hq/telegram) is a complete channel.

MIT

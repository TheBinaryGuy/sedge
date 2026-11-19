# @sedge-hq/kit

Write channels and signals for [sedge](https://sedge.sh), the always-on agent that lives on your
machine.

- A **channel** is how sedge and you talk: Telegram, Slack, email.
- A **signal** wakes sedge when something happens elsewhere: CI failed, a feed changed.

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

Plain TypeScript: `async` functions, and secrets as strings. The kit checks settings, retries
what fails with backoff, stops cleanly and drops repeats, on [Effect](https://effect.website)
underneath; `@sedge-hq/kit/effect` is the same kit with Effect showing. `secret(...)` settings are
typed into a hidden field and kept in the OS keychain. The full guide is
[The kit](https://github.com/sedge-hq/sedge/blob/main/docs/kit.md), and
[`@sedge-hq/telegram`](https://www.npmjs.com/package/@sedge-hq/telegram) is a complete channel.

MIT

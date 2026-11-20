---
title: Use cases
description: Things to hand sedge, from watering plants to catching a spike in errors.
---

Each one is something you'd type in the TUI, what sedge sets up for it, and what you get
later. Some use a [kind](./channels-and-signals.md#kinds) that's already published; for the rest,
sedge writes a small signal with [the kit](./kit.md) and shows it to you before it runs.

## Around the house

### Keep the plants alive

> I've got a sensor in the basil pot at http://plant.local/reading. Tell me when the soil gets
> dry or the room gets too hot, and offer to run the pump.

- **What it sets up:** a signal it writes for your sensor that reads it every 10 minutes and
  reports when moisture drops below 30% or the temperature goes above 30 °C. If the sensor
  publishes to an MQTT broker, `mqtt` with `when: payload.moisture < 30 or payload.temperature >
  30` and a `throttle` of an hour does the same with nothing to write.
- **What you get:** "The basil is at 24% moisture and 31 °C. Water it?", with **Water** and
  **Not now** buttons. **Water** runs the pump command, after an approval unless you've allowed
  it.

The signal is a few lines:

```ts
import { defineSignal, field } from '@sedge-hq/kit';

interface Reading {
    readonly moisture: number; // percent
    readonly temperature: number; // °C
}

export default defineSignal({
    name: 'plant',
    summary: 'a plant sensor reading too dry or too hot',
    settings: { url: field.text('Where the sensor answers with JSON') },
    every: '10 minutes',
    check: async ({ url }, kit) => {
        const reading = await kit.fetchJson<Reading>(url);
        if (reading.moisture >= 30 && reading.temperature <= 30) return [];
        return [
            {
                text: `Plant: ${reading.moisture}% moisture, ${reading.temperature} °C`,
                key: `plant-${new Date().toISOString().slice(0, 13)}`, // at most once an hour
                details: reading,
            },
        ];
    },
});
```

### Something back in stock

> Tell me when the green kettle on this page is back in stock: https://shop.example/kettle

- **What it sets up:** `web-page`, watching that page for "In stock".
- **What you get:** a message with the link once the text appears, and nothing before then.

### A reminder that remembers why

> Remind me Sunday at 6 to call Mum. She had the hospital appointment on Friday.

- **What it sets up:** a timer. Nothing to connect.
- **What you get:** on Sunday at 6, "Call Mum: ask how Friday's appointment went."

## Posting online

### More likes than usual

> Watch my posts on Bluesky (@me.bsky.social). If one is doing much better than usual, tell me
> while it's still going.

- **What it sets up:** a signal it writes that reads your recent posts every 15 minutes and
  remembers your usual numbers. It reports a post with more than three times your usual likes.
- **What you get:** "Your post about the bike lane has 640 likes in two hours, about 8× your
  usual. 31 replies; two of them are questions." It can draft answers if you ask.

### New posts from someone you follow

> When the Rust blog posts something, tell me what it is in two lines.

- **What it sets up:** `feed`, on the blog's RSS feed.
- **What you get:** a two-line summary and the link, for each new post.

## Building software

### CI goes red

> Tell me when CI on main fails. If it's flaky, rerun it once before telling me.

- **What it sets up:** `github-ci` on your repository.
- **What you get:** nothing for a flaky test that passes the second time. For a real failure,
  which job failed, the error, and the commit that likely caused it. Rerunning is a shell
  command (`gh run rerun`), so it asks you first unless you've allowed shell commands. With the
  [sandbox](./sandbox.md) on, `gh`'s login is hidden, so it can't rerun; it tells you instead.

### Errors climbing in your logs

> Our API logs to /var/log/api/errors.log. If errors jump to well above normal, find out what
> changed.

- **What it sets up:** a signal it writes that counts error lines every 5 minutes, keeps a
  running average, and reports a count more than three times it.
- **What you get:** "Errors went from about 4 to 58 per 5 minutes at 14:10, all
  `TimeoutError` from the payments client. The deploy at 14:05 changed its timeout from 30s to
  3s (a1c9f2e)." It reads the log and your repository before it writes.

### A deploy finishes

> Our deploy script can call a webhook when it's done. When it does, check the site is up and the
> error rate is normal, and only tell me if something's off.

- **What it sets up:** `webhook`, with a token for your deploy script to send.
- **What you get:** nothing when the deploy is fine. When it isn't: "The deploy at 16:02 is up,
  but /checkout returns 500 since then; the log says the new env var `STRIPE_KEY` is missing."

### Review requests and mentions

> Tell me when someone asks me for a review or mentions me on GitHub. Skip the bots.

- **What it sets up:** `github`, for your account.
- **What you get:** each request with what the pull request changes, and mentions with the
  question in them.

### A dependency releases

> When there's a new release of drizzle-orm, check whether it breaks anything for us.

- **What it sets up:** `feed`, on the project's GitHub releases feed.
- **What you get:** the release notes read against your repository: "The new release renames a
  function we call in 3 files. Want a branch with the change?"

## Splitting the work

> Make an agent for CI. It watches main, reruns flaky jobs, and only tells me about real
> failures.

- **What it sets up:** an [agent](./agents.md) named `ci` with its own conversation and memory,
  and the CI signal handed to it.
- **What you get:** the same CI messages, from `ci`. Over time it remembers which tests are
  flaky. It can `tell` the main agent when a failure needs something only you can do.

For a job with many parts, an agent can also start [subagents](./agents.md#subagents). Send this
from your phone, or hand it over in the TUI with `/sedge tell main …` (the TUI's own chat has no
subagents):

> Check which of our 6 services still use the old logging library, and how hard each would be to
> move.

- **What it does:** starts six subagents, one per service, which work at the same time.
- **What you get:** one answer once they've all reported back, with a line per service.

You can watch each agent's inbox, runs and memory in `sedge dash`.

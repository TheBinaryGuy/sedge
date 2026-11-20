# @sedge-hq/web

The web for [sedge](https://sedge.sh), the always-on agent. Two signals:

- **`web-page`**: a page whose text changes (a status page, a price, release notes), with what was
  added; optionally only when it mentions something.
- **`feed`**: new posts on an RSS or Atom feed (a blog, releases, a forum).

Both learn what's there first and report only what's new. Settings: `url`, and `minutes` between
looks (default 15 for a page, 30 for a feed); `web-page` also takes `contains`, to stay quiet
until the changed page mentions it. Each event's details carry its `url` (and for a page, the lines
`removed`), for sedge's `when` conditions. In `sedge`, say "tell me when the Bun
release notes change" or "tell me about new posts on this blog".

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

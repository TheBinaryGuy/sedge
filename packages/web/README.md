# @sedge-hq/web

The web for [sedge](https://sedge.sh), the always-on agent. Two signals:

- **`web-page`**: a page whose text changes (a status page, a price, release notes), with what was
  added; optionally only when it mentions something.
- **`feed`**: new posts on an RSS or Atom feed (a blog, releases, a forum).

Both learn what's there first and report only what's new. In `sedge`, say "tell me when the Bun
release notes change" or "tell me about new posts on this blog".

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

# @sedge-hq/github

GitHub for [sedge](https://sedge.sh), the always-on agent. Two signals:

- **`github-ci`**: Actions runs that fail on a branch ("CI failed on main of me/app: lint").
- **`github`**: pull requests waiting for your review, issues and PRs assigned to you, and where
  you're mentioned.

Both report only what happens after you connect them. In `sedge`, say "tell me when CI fails on
main of me/app" or "tell me when someone asks for my review": sedge installs this package, asks for
a token in a hidden field (a fine-grained token that can read the repositories, and their Actions
for `github-ci`), and keeps it in your keychain. GitHub Enterprise works too (`api`).

Settings: `github-ci` takes `repo` and an optional `branch` (default every branch); `github` takes
`watch` (any of `reviews`, `assigned`, `mentions`; default all three) and `repos` to narrow it to
some repositories. Each event's details carry its `url` (and `by` for CI, `pullRequest` for
assignments), for sedge's `when` conditions.

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

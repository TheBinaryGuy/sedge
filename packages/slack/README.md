# @sedge-hq/slack

Slack for [sedge](https://sedge.sh): message your agent in a DM, and it answers there, with buttons
for its questions and approvals.

It uses Socket Mode, so nothing has to be reachable from the internet. Make an app at
[api.slack.com/apps](https://api.slack.com/apps):

1. **Socket Mode**: turn it on; create the app-level token it offers (`xapp-…`, with
   `connections:write`).
2. **Event Subscriptions**: subscribe to the bot event `message.im`.
3. **Interactivity & Shortcuts**: turn it on (needed for buttons).
4. **App Home**: allow users to send messages from the Messages tab.
5. **OAuth & Permissions**: add the bot scopes `chat:write`, `im:history` and `files:write`;
   install the app, and copy the bot token (`xoxb-…`).

Then in `sedge`, say "set up slack": it asks for both tokens in hidden fields, keeps them in your
keychain, and shows you a code. Send the bot `pair <code>` in a DM: that pairs your account, and
nobody else gets answers.

[Channels and signals](https://github.com/sedge-hq/sedge/blob/main/docs/channels-and-signals.md) · MIT

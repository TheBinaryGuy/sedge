---
'@sedge-hq/sedge': minor
---

Optional limits on what the agents use, all off unless you set them in `limits` in config.json:
runs per hour for each agent, tokens and money per day, and subagents at once. When one is
reached, events from signals, timers and agents wait in the inbox (nothing is dropped), your own
messages still get answers, and sedge tells you once. A new limit applies without a restart.

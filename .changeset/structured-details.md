---
'@sedge-hq/mqtt': minor
'@sedge-hq/local': minor
---

`mqtt` and `webhook` events carry their data as details (`topic` and `payload`, `path` and `body`,
with JSON as values), so a signal's `when` condition can read a field like `payload.moisture`.

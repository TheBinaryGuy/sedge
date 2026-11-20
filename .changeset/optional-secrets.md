---
'@sedge-hq/kit': patch
---

`field.optional(secret(...))` stays a secret: it's typed into a hidden field and kept in the
keychain, and your code gets it as a plain string. Before, wrapping a secret made it an ordinary
setting.

---
'@sedge-hq/sedge': patch
---

Fix a daemon loop that could fill the disk: when the inbox worker or scheduler keeps failing (for example after its database is deleted), it now waits 1 s, 2 s, 4 s … up to a minute between retries and logs one line per repeat. `daemon.log` also rotates past 10 MB.

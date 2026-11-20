---
'@sedge-hq/sedge': patch
---

`sedge` starts on Windows again: the binary no longer mistakes itself for a source checkout and
looks for pi's package.json (`Cannot find module '@earendil-works/pi-coding-agent/package.json'`).
Starting the daemon and `sedge update` on Windows had the same mistake.

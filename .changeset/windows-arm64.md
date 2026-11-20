---
'@sedge-hq/sedge': patch
---

sedge now has a native Windows ARM64 binary (`@sedge-hq/sedge-windows-arm64`). When npm leaves out
this machine's binary, `sedge` now says how to fix it: stop any running sedge and reinstall.

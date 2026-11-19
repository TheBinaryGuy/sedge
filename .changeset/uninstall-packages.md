---
'@sedge-hq/sedge': minor
---

`sedge uninstall` removes sedge from your machine: the daemon, the login service, its keychain
secrets and `~/.sedge`, after showing what goes and asking (`--keep-data` keeps `~/.sedge`).
`sedge uninstall <package>` removes a package of channels and signals, and the agent can do that
too with the `uninstall` tool. A package stays while anything it provides is connected.

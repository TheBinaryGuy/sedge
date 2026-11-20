---
'@sedge-hq/sedge': minor
---

An optional sandbox for the daemon's agent, off unless `sandbox.enabled` is set in config.json.
Commands run in the operating system's sandbox (Seatbelt on macOS, bubblewrap on Linux) and file
tools keep to the same rules: writes stay in the run's folder, the workspace, temp, package caches
and the folders you list; credentials (`~/.ssh`, cloud logins, pi logins, sedge's secrets) and the
paths you list can't be read; the network can be turned off. Where no sandbox is available,
commands don't run while it's on.

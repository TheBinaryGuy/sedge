---
'@sedge-hq/sedge': minor
---

Choose the model the daemon's runs use: for the daemon as a whole (`model`), per agent
(`agents.<name>.model`) and per channel or signal (`connections.<name>.model`), each with an
optional thinking level (`anthropic/claude-opus-5-5:medium`). Send `/model` on a channel to pick
one with buttons, or `/model opus medium`; in the TUI, ask and the agent uses the new `models` and
`set_model` tools. Changes apply from the next run, without a restart.

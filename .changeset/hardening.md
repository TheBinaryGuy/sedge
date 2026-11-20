---
'@sedge-hq/sedge': minor
---

Security fixes from adversarial testing:

- The sandbox now hides all of sedge's own files (database, conversations, logs, packages, not just
  the config and secrets) and blocks connecting to its socket, through which a sandboxed command
  could ask the daemon to run something outside the sandbox. Commands in it also no longer get
  environment variables named like credentials.
- sedge's own files are off limits to file tools by resolved path (`../config.json` from the
  workspace, links), not only by their full path, and `send_message` won't attach them.
- A run woken by your answer to an approval, or by a pick of a button, keeps the stricter rules
  when the run that asked was woken by outside content. Buttons the agent makes can no longer pass
  for sedge's approve and deny ones.
- Approval messages show the whole call: a command in full, a write's content, an edit's changes,
  whether the run was woken by outside content, and say so when it's cut.
- Runs woken by outside content may write in their own folder and the workspace again under your
  usual `permissions.write`; only writes elsewhere ask, so a signal's agent can do its work without
  asking at every file.
- `~` paths (`~/.sedge/config.json`) are resolved to the home folder in every check, as the tools
  read them; `find` and `grep` skip sedge's own files in every folder they search; credential
  variables are taken out when a sandboxed command starts; runs woken by outside content can't set
  named values or write into a project's `.pi` folder without asking.


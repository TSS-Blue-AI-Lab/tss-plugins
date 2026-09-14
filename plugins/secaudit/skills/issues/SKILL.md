---
name: issues
description: >-
  Open the secaudit Workbench: sync the persistent issue board with every
  discoverable run in this project, then serve it locally so triage decisions
  (confirm, done, false positive) persist across audits and restarts.
disable-model-invocation: true
argument-hint: "[project-path]"
---

# secaudit:issues — open the Workbench

## Step 0 — preflight Node

Run `node --version`. If it fails or reports a major version below 22, STOP and tell the user
secaudit requires Node.js 22 or newer on PATH. Do not work around it.

## Step 0b — resolve PLUGIN_ROOT

PLUGIN_ROOT is `${CLAUDE_PLUGIN_ROOT}` in Claude Code; in any other client it is the directory
two levels above this file. Quote it — the plugin may be installed under a path containing
spaces. Never substitute the audited project for it.

## Step 1 — resolve the project

The project is the directory holding `.secaudit`. If the user gave a path, use it. Otherwise use
the Git toplevel above the current directory, else the current directory. Show the resolved path
before doing anything else.

## Step 2 — sync

```
node "<PLUGIN_ROOT>/skills/issues/scripts/sync.mjs" --project "<project>"
```

Report `summary` verbatim: `new`, `repeat`, `reopened`, `suppressed`, `ambiguous`, `refuted`,
`unrefuted`. A `repeat` is not a new finding. A `refuted` went straight to the archive on the
audit's own verdict and was never in anyone's inbox. An `unrefuted` is a finding a later run
stopped refuting, so it is now awaiting triage. Name every `unavailable` run and its reason.

## Step 3 — serve

```
node "<PLUGIN_ROOT>/skills/issues/scripts/server.mjs" --project "<project>"
```

It prints `{"url":"http://127.0.0.1:<port>"}`. Give the user the URL. The server binds to
loopback only and serves one project. Tell the user to stop it with Ctrl-C when finished.

## What the board does and does not do

- Human decisions are the only thing that moves a card. An audit verdict of DEFECT is not a
  human confirmation.
- A finding a human marked a false positive is archived and never raised again by a later audit.
  Only an explicit Restore returns it to the inbox.
- A finding the AUDIT refuted is archived too, but provisionally: it is labelled as the audit's
  verdict, it is not suppressed in later reports, and a later run that stops refuting it puts it
  back in the inbox. Only human dismissals are absolute.
- A finding that stops appearing is NOT marked done: scope and coverage differ between runs.
- Historical reports are unchanged by anything done on the board.

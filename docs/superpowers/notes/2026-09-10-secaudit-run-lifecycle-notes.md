# Implementation Notes — secaudit Run Lifecycle (Part 1 of 3)

**Plan:** `docs/superpowers/plans/2026-09-10-secaudit-run-lifecycle.md`
**Branch:** `docs/secaudit-workbench-plans`

## Deviations

### D1 — Worked in place instead of a fresh worktree
The executing-plans skill requires an isolated workspace. `EnterWorktree` branches from
`origin/main` by default, which would have stranded `b2438bc` (the three plans plus the spec
revision) — the plans being executed. The session was already on the dedicated branch
`docs/secaudit-workbench-plans`, never on `main`, so the isolation that matters (main is
untouched) already held. Worked in place on that branch.

### D2 — Marker gained no `runtimeVersion` field
Task 3's Interfaces block lists `runtimeVersion: 2` among the marker's new fields, but the
task's own marker code block (the authoritative one, and what the test asserts) omits it.
Wrote the code block as given. `formatVersion: 2` from Task 1 already carries the same
"this marker is the v2 shape" fact, so a second version number would be one more thing that
can disagree with itself.

### D3 — Workflow names the run's scope `auditScope`, not `scope`
Task 6 says to add `const scope = Array.isArray(args.scope) ? args.scope : []` to
`workflows/secaudit.js`. That file already uses `scope` as the hunt-round parameter meaning
"the focused re-hunt task list" (`scope=null → full first round`). Two different meanings under
one name in one file is a misreading waiting to happen, so the run context is `auditScope`.
The ledger line still prints `scope=…` as the plan specifies, and the workflow result still
returns the field as `scope`.

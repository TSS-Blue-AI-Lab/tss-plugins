# Implementation Notes — secaudit issue store migration seam

Plan: `docs/superpowers/plans/2026-09-11-secaudit-issue-store-migrations.md`
Branch: `docs/secaudit-workbench-plans`

## Deviations

### D1 — Plan's test fixture clobbered the issue id

The plan's `v1Issue` helper put `id: 'iss_' + (over.id ?? …)` before `...over`, so
`v1Issue({ id: 'bbbb…' })` produced an issue whose id was the bare suffix rather than the
prefixed identifier, and every lookup in the test returned undefined. Moved the derived `id`
after the spread. No production code was involved.

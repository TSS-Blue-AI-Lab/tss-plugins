# Implementation Notes — Marketplace Scaffolding

Execution of `docs/superpowers/plans/2026-08-04-marketplace-scaffolding.md`
on branch `feat/marketplace-scaffolding` (base `b848a41`).

## Deviations

### Task 5 — `.secaudit-local/` removed from the forbidden-references list

The plan's `forbidden-references.test.mjs` listed `.secaudit-local/` as a forbidden
string. The dev repo's `scripts/preflight.mjs` had deliberately excluded it, with a
documented reason: naming the gitignored developer root in prose (the README's Layout
section) is accurate documentation, not a leak — what must never ship is the directory
itself. The plan contradicted that decision; the test now matches upstream's intent and
records why, so nobody re-adds it. Conservative choice: adjust the test that was wrong
rather than edit imported plugin content that was right.

### Task 5 — `validate-workflows.test.mjs` reduced to CI-only

The ported test asserted the shape of a `release.yml` (build/publish jobs, tag-only
trigger, single `contents: write` grant). This repo deliberately dropped release
packaging, so that workflow has no subject here. Per the plan's own rule — keep every
assertion that still has a subject, delete only those whose subject no longer exists by
design — the release-specific assertions were removed and the generic hardening loop
(SHA-pinned actions, read-only default permissions, no `${{ }}` inside `run:` bodies,
`shell: bash` on every run step) now runs against `ci.yml` alone, alongside the
platform-matrix and no-write assertions.

Consequence: this test constrains Task 6's `ci.yml` — every `run:` step must declare
`shell: bash` and every action must be pinned to a full commit SHA.

### Task 5 — one test knowingly left red at task end

`validate-workflows.test.mjs` cannot pass until `.github/workflows/ci.yml` exists, which
is Task 6's deliverable. It was verified to fail only with ENOENT on that path, never
with an assertion error, and is expected to go green in Task 6.

## Notes

- Deferred minor: `plugins/secaudit/README.md`'s Layout section still describes the old
  dev-repo layout (tests at the repo root, `for t in tests/*.test.mjs`). Tests now live
  at `tests/secaudit/`. Left unedited during the verbatim import; flagged for triage.

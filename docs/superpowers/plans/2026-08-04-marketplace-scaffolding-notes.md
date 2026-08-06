# Implementation Notes — Marketplace Scaffolding

Execution of `2026-08-04-marketplace-scaffolding.md` (this file's sibling)
on branch `feat/marketplace-scaffolding` (base `b8b6e02`).

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

### Final review — third install channel dropped

The plan and the root README advertised a third install channel for agents other than
Claude Code and Codex, via the `skills` CLI. Nothing in the implementation supported it:
no task built it, no test covered it, and the documented command used a flag that does not
exist in that CLI — a public reader following the README would have hit an error. The
channel was removed from the README and the spec rather than corrected, because the
verified alternative had still never been exercised against this repo. Claude Code and
Codex are the supported channels.

### Final review — CI gained a source-path check

`claude plugin validate --strict` was assumed to catch a dangling plugin source path. It
does not: it passes with `source: "./plugins/nope"`. A jq-based step now asserts that
every catalog entry's plugin directory exists, in both catalogs. Verified to fail on an
injected bad path.

### Final review — plugin README corrected

The imported `plugins/secaudit/README.md` documented the old single-repo marketplace
(`/plugin install secaudit@secaudit`, "the source is the repository itself, not a
subdirectory") and a Layout section listing `tests/` and `docs/` as though they shipped
inside the plugin. Both were rewritten to this repo's reality. This is the one place the
verbatim-import rule was deliberately set aside — the file is user-facing and was wrong.

### Post-review — guessed audit targets are now confirmed

Raised during the branch walkthrough: omitting the repo path lets the runtime pick the target by
walking up to the nearest `.git`, which from a subdirectory silently widens the audit to the whole
repository. Resolution itself was correct and is unchanged; what was missing was consent. `inspect`
now reports `targetSource` (`explicit` | `gitToplevel` | `cwd`), and both launchers (`run`,
`secaudit-orchestrator`) must confirm anything other than `explicit` before `prepare` writes.
An explicitly passed `--target` is unaffected — no extra prompt, and it still accepts a plain
directory, so a subdirectory or non-Git tree can be audited on its own.

## Notes

- Manifests gained the spec-promised fields that the verbatim import lacked:
  `"license": "MIT"` in both plugin manifests, and the `interface` block in the Codex one.
- The root README's plugins table no longer carries a version column; nothing kept it in
  sync with `plugin.json`, so it would have drifted at the first release.
- Deferred minor: the spec's decision item 9 says the dropped installer was "referenced
  earlier in this spec", but that earlier reference was itself removed in the same pass.
  Harmless wording artifact.
- Deferred minors (cosmetic, tests pass): stale comment wording in
  `tests/secaudit/validate-explicit-only.test.mjs` and `validate-manifests.test.mjs` was
  corrected during the fix wave.
- Resolved on the first real push: `claude plugin validate` does run unauthenticated on a
  GitHub Actions runner. Everything else in CI had already been reproduced locally.

# Implementation Notes — secaudit Issue Store and Cross-Run Identity (Part 2 of 3)

**Plan:** `docs/superpowers/plans/2026-09-10-secaudit-issue-store.md`
**Branch:** `docs/secaudit-workbench-plans`

## Deviations

### D1 — `.secaudit/` now ignores its own contents, and the "target untouched" test was narrowed
Task 1 has `prepare` register a non-default run in `<projectRoot>/.secaudit/catalog.json`.
`runtime-prepare.test.mjs` asserted that an explicit external `--output` creates no `.secaudit`
in the target at all, and a second case asserted an in-target run leaves `git status` clean —
the catalog broke both. Registration is the whole point of the catalog (an externally placed
run is not rediscoverable by walking the filesystem), so instead of dropping it,
`run-catalog.mjs` writes `<projectRoot>/.secaudit/.gitignore` containing `*` when it creates
the index directory — the same guarantee each run directory already gives its work tree. The
first assertion was narrowed to what still holds and matters: no run directory in the target,
the audited source byte-identical, and `.secaudit/` holding nothing but the ignore file and the
catalog.

### D2 — `skills/issues/SKILL.md` and its Codex gate landed with Part 2, not Part 3
`validate-manifests` and `validate-explicit-only` walk every `skills/*` directory, so creating
`skills/issues/scripts/` in Part 2 Task 1 broke both immediately. Wrote the real SKILL.md from
Part 3 Task 6 (not a placeholder) rather than leaving the suite red across two plans.
`validate-explicit-only` allowed `disable-model-invocation: true` only on the two
full-pipeline entry points; `issues` is explicit-only for a different reason — it starts a
long-lived local server — so it got its own `SERVERS` category in that test plus an
`agents/openai.yaml`, keeping the gate consistent in both clients.

### D3 — `normalizeCodeLine` and `METHODLIKE` needed real implementations, not the plan's
Two of Task 2's code blocks did not satisfy Task 2's own tests, so the source was fixed rather
than the tests (as the task instructs).
1. The plan's `normalizeCodeLine` was `replace(/\s+/g, ' ').trim()`, which collapses whitespace
   *inside* string literals — contradicting the stated interface ("string literals are
   preserved verbatim") and the test. Replaced with a quote-aware scan: whitespace collapses
   outside literals only, since whitespace inside one is part of the value.
2. `METHODLIKE` matched any call statement, so `return Sql(id);` anchored to `Sql` instead of
   the enclosing method `Get`. Added a `CONTROL_KEYWORDS` guard on the leading token; without
   it every call site reads as its own declaration and the anchor stops being stable.

### D4 — `findMatch` resemblance now only bridges the legacy/anchor namespace gap
Task 5's `findMatch` fell back to "same class and path" resemblance for ANY observation whose
fingerprint did not match exactly, which collapsed two genuinely distinct anchored defects in
one file into one issue — the task's own test ("two independent defects in one file remain two
issues") caught it. Two differing anchored fingerprints are two defects; that is what the
anchor is for. Resemblance is now restricted to the case the plan's prose describes: an
observation whose fingerprint kind (legacy vs anchor) no existing issue on that file holds, so
no comparison is possible and only a human can decide.

### D5 — `writeStore` reuses the catalog's ignored-directory helper
`issues.json` lands in the same `.secaudit/` the catalog does, so it inherits the same
requirement (D1): the directory must ignore its own contents or every audited repo shows up
dirty. Exported `ensureIgnoredDir` from `run-catalog.mjs` rather than duplicating it.

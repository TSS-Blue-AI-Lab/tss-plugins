---
name: secaudit-generate-artifacts
description: >-
  Generate Artifacts (final Glasswing stage). Assembles a schema-validated
  report-data.json from architecture.md, every *-results.md, deduped.md, and the
  run's Hunter list/date/coverage, deterministically renders it into
  final-report.md/.html via render-report.mjs, then publishes report.md/report.html/
  trace.md into the run directory via publish-artifacts.mjs after re-verifying the
  source corpus is still pristine. Deterministic reshape — the model only assembles
  facts, it never hand-writes visible buckets, counts, Markdown, or HTML. Replaces
  the old free-form sast-report skill and the Harvest stage.
---

# Generate Artifacts — deterministic assembly, render, and publish

## Step 0 — resolve PLUGIN_ROOT (once, then reuse)

The scripts below are bundled with secaudit, not scripts in the repository being audited. The
plugin root and the audit target are different roots and are never derived from each other.

- **Claude Code:** PLUGIN_ROOT is `${CLAUDE_PLUGIN_ROOT}` — expanded to the plugin's absolute
  installation directory before you read this file. If you literally see the unexpanded
  placeholder, use the fallback rule below.
- **Any other client (Codex and friends):** PLUGIN_ROOT is the directory two levels above this
  file — this file is `<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/SKILL.md`.

Substitute that absolute path for `<PLUGIN_ROOT>` in every command below and always quote it, as
well as every target/work/run path — any of them may contain spaces.

## Generate
Owns assembly, validation, and rendering.

1. Assemble `report-data.json` from `architecture.md`, every `*-results.md`, `deduped.md`,
   the supplied Hunter list/date/coverage, and the trace decisions. `NOT-A-DEFECT` findings
   come from the per-Hunter `*-results.md` files (Dedupe drops them); `DEFECT` and `UNSURE`
   records come from `deduped.md` (its `**Trace:**` line supplies each DEFECT's reachability
   verdict and evidence).
2. Compute each `finding.id` with `findingId(finding)` from `report-contract.mjs` (a
   deterministic sha256-based key over class/path/line/title) — never invent a sequential or
   bucket-prefixed ID scheme; `report-contract.mjs` rejects any `id` that doesn't match.
   Display order is not your job either: `render-report.mjs` sorts each bucket (Confirmed /
   Refuted / Manual Review) by descending severity, then class, title, path, and line via
   `sortFindings()` at render time.
3. Preserve the two Manual Review sub-statuses — `runtime-proof` (Trace `NEEDS-PROOF`) and
   `defect-determination` (Challenge `UNSURE`). Never ask the model to emit visible buckets,
   counts, Markdown, or HTML — that is `render-report.mjs`'s job, driven purely by
   `challengeVerdict`/`traceVerdict` via `classifyFinding()`.
4. Write `<work>/sast/report-data.json` and validate it against `report-data.schema.json`
   (call `validateReportData` from `report-contract.mjs`) before moving on. A finding that
   fails validation (missing severity/impact/remediation for Confirmed or runtime-proof, a
   non-null severity on Refuted/defect-determination, etc.) means the assembly is wrong —
   fix the assembly, do not loosen the schema.
5. Run `render-report.mjs` to finish Generate:
   ```
   node "<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/scripts/render-report.mjs" \
     --data "<work>/sast/report-data.json" \
     --out-md "<work>/sast/final-report.md" \
     --out-html "<work>/sast/final-report.html"
   ```

## Publish
Owns copying, trace, pruning, and integrity verification. Run `publish-artifacts.mjs`
as a separate step, after Generate has succeeded:
```
node "<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs" \
  --target "<target>" \
  --expected-hash <corpusSha256> \
  --work "<work>" \
  --run-dir "<runDir>" \
  --ledger "<work>/sast/run-ledger.json"
```
It re-hashes `<target>` with the same shared exclusion policy `prepare` used and refuses
to copy or prune anything if the corpus is no longer byte-identical to the hash captured
at Recon Prepare. On success it copies
`final-report.md` / `final-report.html` into `<runDir>` as `report.md` / `report.html`,
writes `<runDir>/trace.md` (corpus hash, coverage, template version, and the ledger file's
contents verbatim), and prunes everything under `<work>` except `<work>/sast/`. It prints
one JSON line `{confirmed, refuted, manualReview}` — that line is the stage result.

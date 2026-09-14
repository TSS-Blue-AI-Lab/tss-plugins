---
name: secaudit-generate-artifacts
description: >-
  Generate Artifacts (final Glasswing stage). Assembles a schema-validated
  report-data.json from architecture.md, every *-results.md, deduped.md, and the
  run's Hunter list/date/coverage, then publishes trace.md into the run directory via
  publish-artifacts.mjs after re-verifying the source corpus is still pristine. No
  report is rendered — report-data.json is the run's structured record and the
  secaudit:issues dashboard is the human view. Deterministic reshape — the model only
  assembles facts, it never hand-writes visible buckets or counts. Replaces the old
  free-form sast-report skill and the Harvest stage.
---

# Generate Artifacts — deterministic assembly and publish

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
Owns assembly and validation. The run produces structured findings and a provenance trace;
the human view is the `secaudit:issues` dashboard, which reads `report-data.json`.

1. Assemble `report-data.json` from `architecture.md`, every `*-results.md`, `deduped.md`,
   the supplied Hunter list/date/coverage, and the trace decisions. `NOT-A-DEFECT` findings
   come from the per-Hunter `*-results.md` files (Dedupe drops them); `DEFECT` and `UNSURE`
   records come from `deduped.md` (its `**Trace:**` line supplies each DEFECT's reachability
   verdict and evidence).
2. Compute each `finding.id` with `findingId(finding)` from `report-contract.mjs` (a
   deterministic sha256-based key over class/path/line/title) — never invent a sequential or
   bucket-prefixed ID scheme; `report-contract.mjs` rejects any `id` that doesn't match.
   Display order is not your job either: the dashboard sorts each bucket by descending
   severity, then class, title, path, and line via `sortFindings()` from
   `report-contract.mjs`.
3. Preserve the two Manual Review sub-statuses — `runtime-proof` (Trace `NEEDS-PROOF`) and
   `defect-determination` (Challenge `UNSURE`). Never ask the model to emit visible buckets,
   counts, Markdown, or HTML. Bucketing is derived from `challengeVerdict`/`traceVerdict`
   via `classifyFinding()`.
4. Write `<work>/sast/report-data.json` and validate it against `report-data.schema.json`
   (call `validateReportData` from `report-contract.mjs`) before moving on. A finding that
   fails validation (missing severity/impact/remediation for Confirmed or runtime-proof, a
   non-null severity on Refuted/defect-determination, etc.) means the assembly is wrong —
   fix the assembly, do not loosen the schema. That file is Generate's deliverable.

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
at Recon Prepare. On success it writes `<runDir>/trace.md` (corpus hash, coverage, template version, and the ledger file's
contents verbatim), and prunes everything under `<work>` except `<work>/sast/`. It prints
one JSON line `{confirmed, refuted, manualReview}` — that line is the stage result.

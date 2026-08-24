---
name: secaudit-orchestrator
description: >-
  Portable prose runbook for the full secaudit code-audit pipeline, for harnesses
  WITHOUT the Claude Code Workflow engine (e.g. Codex). Drives the same secaudit
  SKILL.md skills stage-by-stage: Recon → Hunt → Challenge → [Blindspot Sweep] →
  Dedupe → Trace → Generate Artifacts. On Claude Code, prefer the deterministic
  workflow (Workflow name "secaudit") instead. Use when running the audit somewhere
  the .js workflow cannot execute.
disable-model-invocation: true
---

# secaudit — portable orchestration runbook

> On Claude Code, use the secaudit:run skill instead (it inspects, confirms, prepares, and starts the deterministic workflow with the required handshake). Use this runbook only where the Workflow engine is unavailable. The stage order, fan-out, and single-replay bound below are the same guarantees the workflow enforces in code — here they depend on you following them.

## Cost controls (agent count = token cost)
The full pipeline spawns one agent per Hunter, one Challenger per Hunter that produced findings, and batched Trace agents; on a large corpus that is expensive. Scale it down the same way the workflow's config does:
- **Hunter subset** — run only the classes you care about (e.g. `sqli, rce, idor, missingauth, ssrf, hardcodedsecrets`) instead of all 14. Fewer Hunt agents.
- **Challenge pairing** — one fresh Challenger subagent per Hunter that produced new findings (1:1 Hunter→Challenger), each challenging ONLY its Hunter's findings. Agent count per round is therefore at most the Hunter count by construction. Do not batch Challenge by size, and never run one agent over all findings.
- **Trace agent-count cap** — per round, Trace agents are capped at the Hunter count, batched in groups (default 5 per subagent). If records exceed cap × batch size, GROW the batch size (ceil(records / cap)), never the agent count. Every record is still traced.

## Reliability rules (fail loud)
The workflow enforces these in code; here they depend on you following them:
- A dead subagent (error, or empty/garbage return) is retried ONCE. If it is still dead after the retry, STOP the whole run and tell the user which stage failed — never continue past a missing artifact.
- This applies to: each Hunter, each per-Hunter Challenger, each Trace batch, and every single-agent stage (Recon Map, finding-collection, Dedupe, Trace merge, Generate Artifacts' assemble/render/publish).
- Rationale: a silently dropped Hunter means partial coverage, and an un-challenged finding silently vanishes at Dedupe (only DEFECT-tagged findings carry forward). Both produce a false all-clear — worse than no report.

## Step 0 — resolve PLUGIN_ROOT (once, then reuse)

The commands below run scripts bundled with secaudit, not scripts in the repository being
audited. The plugin root and the audit target are different roots and are never derived from
each other.

- PLUGIN_ROOT is the directory two levels above this file — this file is
  `<PLUGIN_ROOT>/skills/secaudit-orchestrator/SKILL.md`.
- On Claude Code the placeholder `${CLAUDE_PLUGIN_ROOT}` also expands to that same absolute
  path; on other clients nothing is expanded, so use the rule above.

Substitute that absolute path for `<PLUGIN_ROOT>` in every command below and always quote it —
the plugin may be installed under a path containing spaces.

## Sniff (cheap, no subagents — do this FIRST)
Inspect the target to ground the Hunter recommendation and cost estimate:
- Run the deterministic inspection (read-only, never writes to the target):
  `node "<PLUGIN_ROOT>/skills/run/scripts/secaudit-runtime.mjs" inspect --target "<target>"` — omit
  `--target` when the user gave no path (the runtime resolves the Git toplevel, else the
  invocation directory). Parse its one-line JSON `{target, targetSource, artifactRoot,
  artifactRootSource, coverage, extensions, manifests, warnings, …}`, show the resolved `target`
  to the user, and surface any `warnings` verbatim.
- **Say where the report will land**: `<artifactRoot>/.secaudit/runs/`. The run directory follows
  the PROJECT root, not the audited tree — the audited tree's own repository, else the repository
  you are standing in (which is what keeps an audit of a staged or copied workspace out of that
  copy), else the target. Point it elsewhere with `--output`.
- **A guessed target must be confirmed before anything is written.** `targetSource` is
  `explicit` (user named it), `gitToplevel` (walked up to the nearest repository root) or `cwd`.
  A guess can be wider than intended — invoked from `repo/services/api` it audits all of `repo`
  — so when it is not `explicit`, ask the user to confirm the path or supply another, alongside
  the size line below. On a different path, re-run `inspect --target "<their path>"` and redo
  this section; the earlier `coverage` and recommendations are stale.
- **Print the size line** from `coverage`: `Repo: <sourceLines> source LOC,
  ~<estimatedSourceTokens> source tokens`.
- **Estimate full-scan token cost and tell the user.** Rough heuristic: `FIXED ≈ 120k` (Recon + Dedupe + Trace + Generate Artifacts) plus `nHunters × (40k + coverage.estimatedSourceTokens)`; a Blindspot Sweep replay roughly doubles the hunt+challenge portion. Print an order-of-magnitude bracket, e.g. `Est. full scan (N hunters, blindspot sweep off): ~XXXk–YYYk tokens.` — a bracket, not false precision.
- **Map findings to a RECOMMENDED Hunter subset** of the 14 classes (`businesslogic, fileupload, graphql, hardcodedsecrets, idor, jwt, missingauth, pathtraversal, rce, sqli, ssrf, ssti, xss, xxe`). Rule of thumb: always include `sqli, idor, missingauth, hardcodedsecrets`. Add `ssrf`/`rce` for services that make outbound calls or shell out; `xxe` when XML is parsed; `graphql` only if a GraphQL schema/endpoint exists; `fileupload`/`xss` only if upload or HTML-render surface exists; `jwt` if tokens are issued/verified. Exclude classes with no matching surface and say why.
- **Form a Blindspot Sweep recommendation**: small/simple repo (few files, one service) → sweep OFF; large or high-surface repo → sweep ON. The sweep is off by default and, if enabled and it finds real gaps, adds exactly one extra Hunt+Challenge replay — never more than one.

## Recon / Prepare (isolation — never mutate the corpus)
_The prep half of the Recon stage — the workflow folds these steps into Recon; the map half (`sast-analysis`) is stage 1 below._
1. **Hunter selection is an explicit user choice** — present the Sniff recommendation (recommended subset + why, the full 14-class list verbatim, and the est-token line) and ask for a subset or an explicit "all 14" BEFORE starting. Also ask Blindspot Sweep on/off, labelling your Sniff recommendation. Validate typed Hunter names against the 14-class list; drop unknowns and tell the user which you dropped. Never default silently to the full sweep (that masks a dropped selection and 14×'s the cost). If the user already gave an explicit Hunter list or sweep choice, skip the corresponding question.
2. Prepare the isolated run with the deterministic runtime (validation, hashing, run
   directory, ownership marker, isolated copy — one command, no manual `cp`):
   `node "<PLUGIN_ROOT>/skills/run/scripts/secaudit-runtime.mjs" prepare --target "<target>" [--output "<exact-run-directory>"]`
   Parse its one-line JSON and set `WORK=<work>`, `RUNDIR=<runDir>` — print `RUNDIR`, it is
   where every artifact of this run appears — and keep `coverage`,
   `corpusSha256`, and `generatedDate` unchanged for Generate Artifacts at the end of the
   run. On `{"error":{code,message}}`, report the message and stop — never improvise a
   workspace, and never write the original corpus tree.
3. All stages read/write inside `$WORK/sast/`.
4. Start a running **ledger**: one line per stage event (Hunters chosen, batch size, Blindspot Sweep on/off, per-stage counts, retries) appended as the run progresses — Generate Artifacts' Publish step writes it verbatim into `run-ledger.json` / `trace.md`.

## Make the stages visible (do this before stage 1)

On Claude Code the workflow engine draws one progress group per stage. Running this runbook
as prose there is no such display, so the whole run collapses into one undifferentiated turn
and the user cannot see where it is or where it failed. Before starting stage 1, register the
stages as plan items with whatever planning tool your client provides (Codex: `update_plan`),
then mark each one in progress when you enter it and complete when its artifact exists.

The Blindspot Sweep answer is already known here — it is settled in Recon / Prepare step 1,
before stage 1 — so build the correct list up front rather than editing it mid-run:

- **Sweep off (6 items):** `Recon`, `Hunt`, `Challenge`, `Dedupe`, `Trace`, `Generate Artifacts`.
- **Sweep on (9 items):** the same, plus `Blindspot Sweep`, `Hunt (round 2)` and
  `Challenge (round 2)` registered as their own items directly after `Blindspot Sweep`.

Register the round-2 items rather than reopening the round-1 ones: a completed item flipped
back to in-progress reads as a failed retry, not as the deliberate single replay it is. When
the sweep finds no real gaps, close all three as skipped and go straight to `Dedupe` — an
empty `blindspot-tasks.md` is a completed sweep, not a pending one.

If the client has no planning tool, print a `— stage N/<total>: <name> —` line instead.

This is display only: it never changes the stage order, the fan-out, or the single-replay
bound below. The sweep still runs at most once whatever the plan shows.

## Stages (run in this order)
1. **Recon** — run `sast-analysis` on `$WORK` → `sast/architecture.md` (+ `## Hunt Tasks`). Blocking.
2. **Hunt** — one subagent per Hunter (`sast-<class>`) in parallel, each reading `architecture.md`, writing `sast/<class>-results.md` ending in `## Coverage`. Dead Hunters: retry once, then abort the run — never report on partial coverage (Reliability rules). Each Hunter runs its own skill's method INLINE (no nested subagents — this stage is already fanned out one per Hunter) and reports candidate findings with evidence and a `**Confidence:**` line only; it must NOT judge reachability or suppress uncertain findings (Challenge and Trace do that). (Dependency and vulnerability scanning of manifests/lockfiles is out of scope for this pipeline; run it as a separate standalone step afterward if needed.)
3. **Challenge (fan-out, one Challenger per Hunter)** — collect every un-challenged finding across all `sast/*-results.md` (enumeration only — no judging); group them by Hunter class, then dispatch fresh `secaudit-challenge` subagents in parallel, **one per Hunter that produced new findings**, each handling ONLY that Hunter's findings (cold re-read, judge each independently). Each annotates only its assigned findings (`DEFECT`/`NOT-A-DEFECT`/`UNSURE` + `**Challenge:**`). Do not run one agent over ALL findings, do not batch across Hunters, and do not spawn one agent per finding. Dead Challengers: retry once, then abort (Reliability rules). After Challenge, reconcile: every finding in `sast/*-results.md` must carry a `**Challenge:**` line — a residual un-converted finding would silently drop at Dedupe, so STOP and report it instead of continuing.
4. **Blindspot Sweep (OPTIONAL, single replay — off by default)** — run `secaudit-blindspot-sweep`, which reads every Hunter's own `## Coverage` self-report (Covered / Not covered / Shallow) against `architecture.md` and writes `sast/blindspot-tasks.md`. If it lists real tasks, run ONE more Hunt round scoped to those tasks (append a new `## Round 2` section per affected results file — never rewrite or reorder existing sections), then Challenge the new findings (stage 3 rules — one Challenger per Hunter with new findings). **This is a single pass: do not replay more than once, and skip entirely if the sweep finds no real gaps.**
5. **Dedupe** — run `secaudit-dedupe` → `sast/deduped.md` (carries forward only DEFECT-tagged findings, collapsed to one record per root cause, plus a separate UNSURE section).
6. **Trace (fan-out, batched, capped, race-safe)** — two phases, never one agent over all DEFECTs (it collapses each into a shallow slice at scale):
   - *Collect*: list every `### [DEFECT]` record in `sast/deduped.md` that lacks a `**Trace:**` line (enumeration only).
   - *Phase A (parallel, READ-ONLY)*: fan out `secaudit-trace` subagents over batches of those records (cap = Hunter count, default 5 per subagent, grow the batch not the agent count — see Cost controls). Each traces its records independently and RETURNS verdicts (`REACHABLE` / `UNREACHABLE` / `NEEDS-PROOF` + one-line evidence: entry→sink path, no-path reason, or the exact dynamic test). They must NOT edit any file — parallel writers clobber the single shared `deduped.md`.
   - *Phase B (single writer)*: ONE merge pass adds `**Trace:** <verdict> — <evidence>` under each matching record, keyed strictly by file:line. Nothing else changes.
   - Dead batches: retry once, then abort (Reliability rules).
7. **Generate Artifacts** — read `<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/SKILL.md` and run its Generate then Publish steps exactly (same schema, templates, and scripts the workflow uses — collect → assemble → render → publish):
   - *Collect* was already done in Recon / Prepare (`secaudit-runtime.mjs prepare` → `{coverage, corpusSha256, generatedDate}`).
   - *Assemble* (Generate) — build `$WORK/sast/report-data.json` from `architecture.md`, every `$WORK/sast/*-results.md`, `$WORK/sast/deduped.md`, and the Hunter list/`generatedDate`/`coverage` captured above. `NOT-A-DEFECT` findings come from the per-Hunter results files; `DEFECT`/`UNSURE` records come from `deduped.md`. Validate against `report-data.schema.json` (`validateReportData` from `report-contract.mjs`) before moving on. Never hand-write the visible buckets, counts, Markdown, or HTML yourself.
   - *Render* (finishes Generate):
     ```
     node "<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/scripts/render-report.mjs" \
       --data "$WORK/sast/report-data.json" \
       --out-md "$WORK/sast/final-report.md" \
       --out-html "$WORK/sast/final-report.html"
     ```
   - *Publish* — first write `$WORK/sast/run-ledger.json` (the ledger lines, Hunter list, whether the Blindspot Sweep replayed, and the final Challenge batch count), then:
     ```
     node "<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs" \
       --target "<target>" \
       --expected-hash <corpusSha256> \
       --work "$WORK" \
       --run-dir "$RUNDIR" \
       --ledger "$WORK/sast/run-ledger.json"
     ```
     This re-hashes `<target>` and refuses to copy or prune anything if it is no longer byte-identical to the hash captured in Recon / Prepare — report "corpus not pristine" as a run failure if it aborts. On success it copies `final-report.md`/`final-report.html` into `$RUNDIR` as `report.md`/`report.html`, writes `$RUNDIR/trace.md` (corpus hash, coverage, template version, the ledger contents verbatim), prunes everything under `$WORK` except `$WORK/sast/`, and prints one JSON line `{confirmed, refuted, manualReview}` — that is the run's result.
   - *Verify* — independently confirm the deliverables exist (an agent can report a success the
     script never achieved):
     ```
     node "<PLUGIN_ROOT>/skills/secaudit-generate-artifacts/scripts/verify-artifacts.mjs" --run-dir "$RUNDIR"
     ```
     It prints one JSON line `{sizes, missing}` and exits non-zero when `missing` is non-empty. If
     anything is missing or empty, the publish did not produce the deliverables — report the run as
     failed rather than reporting success.

## After the run
Report the Confirmed / Refuted / Manual Review counts from the publish summary, the top 3 Confirmed findings, and the paths to `report.md`, `report.html`, and `trace.md`. The run directory is ephemeral — git-ignored whenever it sits inside the audited repo, and holding a full copy of that repo including its `.env` — so tell the user to copy out anything worth keeping and delete it when done. Never claim the codebase is "secure."

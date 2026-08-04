---
name: secaudit-blindspot-sweep
description: >-
  Blindspot Sweep (Glasswing stage 4). Reads the hunters' own
  ## Coverage self-reports in sast/*-results.md (Covered / Not covered / Shallow)
  against sast/architecture.md, and emits a targeted list of re-queued hunt tasks to
  sast/blindspot-tasks.md for the high-risk areas the first Hunt round skipped or only
  skimmed. One pass only; the orchestrator runs the re-queued round exactly once. Use
  to counteract the model drifting to attack classes it already succeeded at.
---

# Blindspot Sweep — target what Hunters missed

Worker: Blindspot Sweeper.

## Input
- Every `sast/*-results.md` — especially its `## Coverage` section, the hunter's own
  account of what it Covered, did Not cover, and only looked at Shallow-ly.
- `sast/architecture.md` (entry points, trust boundaries, attack surface) for cross-check.

## Method
1. Read each hunter's `## Coverage`. Collect every **Not covered** and **Shallow** item —
   these are the hunters telling you directly where they fell short.
2. Cross-check against architecture.md's high-risk areas (external entry points; sensitive
   sinks — DB, file, exec, network, deserialization; auth/authz boundaries). A high-risk
   area that a hunter marked Not-covered or Shallow is a priority gap.
3. Also catch silent gaps: a high-risk area in architecture.md that NO hunter's Coverage
   mentions at all (neither covered nor skipped) — it was overlooked entirely.
4. The gap list = (Not-covered ∪ Shallow ∪ silently-overlooked) high-risk areas, per class.

## Output — `sast/blindspot-tasks.md`
Write a re-queue list (same shape Recon uses):

    ## Hunt Tasks
    - sast-hunter-idor: authorization checks on the /admin message handlers (not covered)
    - sast-hunter-rce: deserialization in the Azure Service Bus consumer
    - sast-hunter-sqli: dynamic ORDER BY in the reporting queries

Rules:
- Only name real areas grounded in architecture.md — do not invent endpoints.
- Each task = one attack class + a concrete scope hint.
- If coverage is already adequate, write `## Hunt Tasks` with `- (none)` and say why.
- This is a single pass. Do not loop.

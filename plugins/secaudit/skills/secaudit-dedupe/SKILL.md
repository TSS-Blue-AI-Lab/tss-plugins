---
name: secaudit-dedupe
description: >-
  Deduplication (Glasswing stage 5). Reads all challenged sast/*-results.md, carries
  forward only DEFECT-tagged findings, and collapses findings that share a root cause
  into a single canonical record with a Variants list. Writes sast/deduped.md. Use to
  stop variant analysis from inflating the queue with duplicates before Trace/Report.
---

# Dedupe — one record per root cause

## Input
- Every `sast/*-results.md` after Challenge has tagged them.

## Method
1. Collect only findings tagged `[DEFECT]`. Ignore NOT-A-DEFECT and UNSURE.
2. Two findings share a root cause when they trace to the same underlying flaw —
   e.g. the same unsanitized helper used in three call sites, or the same missing
   auth attribute across sibling endpoints. Same natural key
   (`<class>@<path>:<line>`) is an exact duplicate; same root cause with different
   locations is a variant group.
3. Pick the most representative location as the primary; list the rest as variants.

## Output — `sast/deduped.md`
One record per root cause:

    ### [DEFECT] Missing auth on admin message handlers (Messaging/AdminHandler.cs:20)
    **Class:** missingauth  **Variants:** Messaging/AdminHandler.cs:55, Messaging/AdminHandler.cs:88
    **Challenge:** no [Authorize] / role check before privileged action.

## Unsure (needs manual review)

After the DEFECT records, also carry forward every `[UNSURE]` finding — it means
"needs a human," not "discard." List each one under its own section; do not
merge/collapse them with DEFECT records or with each other, even if they share
a location. `[NOT-A-DEFECT]` findings stay dropped, as before.

    ## Unsure (needs manual review)

    ### [UNSURE] Possible SSRF in webhook dispatcher (Jobs/WebhookSender.cs:88)
    **Challenge:** Destination host comes from a config value of unclear origin; cannot confirm if user-influenced.

Rules:
- Preserve the `**Challenge:**` reason on the primary record.
- Do not drop a distinct root cause just because it is the same attack class.
- If there are zero DEFECT findings, write `sast/deduped.md` with `_No confirmed defects._` (still include the `## Unsure` section if any UNSURE findings exist).

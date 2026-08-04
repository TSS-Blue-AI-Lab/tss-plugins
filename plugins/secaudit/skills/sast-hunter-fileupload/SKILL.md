---
name: sast-hunter-fileupload
description: >-
  Detect insecure file upload vulnerabilities in a codebase using an inline three-phase
  method: discovery (find all upload sites via references/sinks.md), verify (check
  extension bypass and related issues via references/examples.md), and merge (write
  results). Requires sast/architecture.md (run sast-analysis first). Outputs findings
  to sast/fileupload-results.md. Use when asked to find file upload, unrestricted
  upload, or extension bypass bugs.
---

# Insecure File Upload Detection

You are performing a focused security assessment to find insecure file upload vulnerabilities.
Work the method below **inline, in this one context**: discovery → verify → merge. Read the
reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 upload sites) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Discovery: find all file upload sites

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those upload-handling patterns. Find every place a user-supplied file is
received and stored — do not yet evaluate validation. Record each candidate: `file:line`,
the framework/method, and the storage destination.

If you find zero candidates, write `sast/fileupload-results.md` with an empty Findings
section plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: check bypass vectors
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the bypass-vector heuristics (extension check, Content-Type spoofing,
blocklist gaps, case sensitivity, double extension, path traversal, web-executable
storage, magic bytes). Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/fileupload-results.md` using the output format below.

## Output format

```markdown
# File Upload Analysis Results: [Project Name]

## Executive Summary
- Candidates found: [N] (high: [N] / medium: [N] / low: [N])

## Round 1

[All candidate findings for this round. Each is a `### [FINDING] <title> (<file>:<line>)`
 heading with a `**Confidence:** high|medium|low` line directly beneath — see
 references/examples.md for the per-finding format. Do NOT classify as
 vulnerable/not-vulnerable; report candidates with evidence. Order by confidence
 if you like. Downstream Challenge decides defect-ness and Trace decides reachability.]

## Coverage
**Covered:** <files / dirs / entry points you inspected for this class>
**Not covered:** <areas you skipped, and why>
**Shallow:** <areas looked at but not deeply — flag for a deeper second pass>
```

**Re-hunts (loop rounds):** when invoked as a scoped re-hunt, do NOT rewrite this file.
Read it, then append ONE new `## Round N` section (N = the round number you are told)
with only the new candidates — never modify the Executive Summary, an existing
`## Round` section, or the `## Coverage` block.

## Important Reminders

- Read `sast/architecture.md` for tech-stack context before starting.
- **Phase 1 is purely discovery**: find every place a user-supplied file is received and stored. Do not deeply analyze validation in Phase 1 — just note what is visible. That is Phase 2's job.
- **Phase 2 is purely bypass analysis**: for each candidate, examine the validation logic and determine whether it can be bypassed through extension manipulation, case variation, content-type spoofing, or path traversal.
- An allowlist is always stronger than a blocklist. Any blocklist-based approach should be recorded as a `[FINDING]` with at least `**Confidence:** medium` because blocklists are almost always incomplete.
- Content-Type (MIME type from the HTTP header) is **fully attacker-controlled** — never treat it as a security control.
- Case sensitivity matters: `.PHP` bypasses a check for `.php` if `.toLowerCase()` is missing. Always check.
- Path traversal in filenames is a separate attack vector from extension bypass — check for both.
- Even a correct extension check is weakened if the file is stored in a web-executable directory. Note storage location in every finding.
- Magic byte checking (reading actual file bytes) is defense-in-depth but does not replace extension allowlisting — a valid image with PHP code appended can still be dangerous.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.

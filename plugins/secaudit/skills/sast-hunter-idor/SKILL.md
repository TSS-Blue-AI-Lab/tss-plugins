---
name: sast-hunter-idor
description: >-
  Detect Insecure Direct Object Reference (IDOR) vulnerabilities in a codebase
  using an inline three-phase method: recon (find candidate endpoints via
  references/sinks.md), verify (authorization analysis via
  references/examples.md), and merge (write results). Checks endpoints for
  missing ownership or authorization checks on user-supplied identifiers.
  Requires sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/idor-results.md. Use when asked to find IDOR or authorization bypass bugs.
---

# IDOR (Insecure Direct Object Reference) Detection

You are performing a focused security assessment to find IDOR vulnerabilities.
Work the method below **inline, in this one context**: recon → verify → merge. Read the
reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 candidates) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find candidate endpoints
Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for endpoints/handlers that access an object via a user-supplied identifier.
Do not yet decide whether an authorization check is present. Record each candidate:
`file:line`, the endpoint, the identifier source, and the operation.

If you find zero candidates, write `sast/idor-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: authorization analysis
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the authorization heuristics. Determine whether the requesting user's
identity is checked against the specific object being accessed. Keep the real ones;
drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/idor-results.md` using the output format below.

## Output format

```markdown
# IDOR Analysis Results: [Project Name]

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
- Focus on **horizontal privilege escalation** (user-to-user). Vertical escalation (user-to-admin) is a different skill (sast-hunter-missingauth).
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Trace the full code path: route → middleware → controller → service → data access. Authorization can happen at any layer.
- Pay attention to framework conventions. In Rails, `current_user.orders.find(id)` is safe. In Express, just having `auth` middleware doesn't mean ownership is checked.

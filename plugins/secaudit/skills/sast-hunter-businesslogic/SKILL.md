---
name: sast-hunter-businesslogic
description: >-
  Detect business logic vulnerabilities in a codebase using an inline three-phase
  method: threat modeling (domain analysis and attack scenarios via
  references/sinks.md), verify (check exploitable gaps via references/examples.md),
  and merge (write results). Covers price manipulation, workflow bypass, limit
  violations, race conditions, reward abuse, etc. Requires sast/architecture.md (run
  sast-analysis first). Outputs findings to sast/businesslogic-results.md. Use when
  asked to find business logic, logic flaws, or abuse-of-function bugs.
---

# Business Logic Vulnerability Detection

You are performing a focused security assessment to find business logic vulnerabilities.
Work the method below **inline, in this one context**: threat modeling → verify → merge.
Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 scenarios) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Threat modeling: domain analysis & attack scenario generation
Read `references/sinks.md`. Using `sast/architecture.md` and the codebase, identify the
business domain, features, and rules (Step 1), then generate specific, grounded attack
scenarios per relevant category (Step 2, checklist cross-references
`references/examples.md`'s "Business Logic Attack Categories"). Record each scenario with
its target endpoint/feature and the business rule that should be enforced.

If you generate zero scenarios, write `sast/businesslogic-results.md` with an empty
Findings section plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: check whether scenarios are exploitable
For each scenario, read `references/examples.md` for concept, attack categories, and the
verify heuristics (is the rule enforced server-side, is validation complete, workflow /
coupon / race-condition / entitlement / transfer specific checks). Keep the exploitable
ones; drop properly-enforced scenarios.

### Phase 3 — Merge: write results
Write `sast/businesslogic-results.md` using the output format below.

## Output format

```markdown
# Business Logic Analysis Results: [Project Name]

## Executive Summary
- Candidates found: [N] (high: [N] / medium: [N] / low: [N])

## Round 1

[All candidate findings for this round. Each is a `### [FINDING] <title> (<file>:<line>)`
 heading with a `**Confidence:** high|medium|low` line directly beneath — see
 references/examples.md for the per-finding format. Do NOT classify as
 exploitable/not-exploitable; report candidates with evidence. Order by confidence
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
- Focus strictly on **business logic flaws** — do not flag injection bugs, auth bypass, or IDOR issues here.
- Threat modeling in Phase 1 should be **application-specific**: generic scenarios not grounded in the actual codebase are not useful.
- Server-side validation is the only valid protection. Client-side validation, frontend form constraints, and API documentation that says "must be positive" are not security controls.
- Race conditions on financial operations are high-severity even if they appear to require exact timing — automated tools (Turbo Intruder, concurrent curl) make them trivial to exploit.
- Pay attention to ORM and database-level constraints (CHECK constraints, unique indexes, transactions with locking) — these can provide enforcement that is not visible in application code alone.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.

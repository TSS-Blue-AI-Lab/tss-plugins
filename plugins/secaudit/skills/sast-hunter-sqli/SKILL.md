---
name: sast-hunter-sqli
description: >-
  Detect SQL injection vulnerabilities in a codebase using an inline three-phase
  method: recon (find unsafe SQL construction sites via references/sinks.md), verify
  (taint analysis via references/examples.md), and merge (write results). Covers
  string concat, f-strings, unsafe ORM methods, and dynamic identifiers. Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/sqli-results.md. Use when asked to find SQLi or database injection bugs.
---

# SQL Injection (SQLi) Detection

You are performing a focused security assessment to find SQL injection vulnerabilities.
Work the method below **inline, in this one context**: recon → verify → merge. Read the
reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 candidate sites) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find vulnerable SQL construction sites

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag ANY dynamic variable embedded in a query string —
do not yet decide whether it is user-controlled. Record each candidate: `file:line`, the
sink call, and the dynamic expression.

If you find zero candidates, write `sast/sqli-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: taint analysis
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the sink without parameterization or effective validation. Keep the real ones;
drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/sqli-results.md` using the output format below.

## Output format

```markdown
# SQLi Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any dynamic variable embedded in a SQL query string, regardless of origin. Do not trace user input in Phase 1 — that is Phase 2's job.
- **Phase 2 is purely taint analysis**: for each candidate, trace the interpolated variable back to its origin. If it comes from a user-controlled source, the site is a real vulnerability.
- Focus on **raw SQL and ORM raw/unsafe methods**. Standard ORM query builder calls (`.filter()`, `.where(col: val)`, `.find()`) are safe by default — do not flag them.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Taint can flow indirectly: a request parameter may be extracted in a middleware, stored in a shared object, passed through several helper functions, and finally reach the query construction. Trace the full chain.
- Custom escaping (including `mysql_real_escape_string`, `addslashes`, or homegrown sanitizers) is **not** equivalent to parameterization — record as a `[FINDING]` with `**Confidence:** medium` even if escaping is present.
- For dynamic identifiers (column/table names), parameterization cannot help — the only safe fix is allowlist validation. Flag any dynamic identifier without an allowlist, regardless of whether it appears user-controlled.
- Second-order injection is easy to miss: a value stored in the DB from user input may later be read and used unsafely in a raw query elsewhere in the codebase. Treat DB-read values as potentially tainted and trace back to where they were written.

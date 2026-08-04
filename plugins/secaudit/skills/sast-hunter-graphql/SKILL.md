---
name: sast-hunter-graphql
description: >-
  Detect GraphQL injection vulnerabilities in a codebase using an inline three-phase
  method: recon (confirm GraphQL usage and find unsafe operation document assembly
  sites via references/sinks.md), verify (trace user input via references/examples.md),
  and merge (write results). Requires sast/architecture.md (run sast-analysis first).
  Outputs findings to sast/graphql-results.md. If no GraphQL technology is found in
  recon, later phases are skipped. Use when asked to find GraphQL injection, unsafe
  GraphQL document construction, or operation string injection bugs.
---

# GraphQL Injection Detection

You are performing a focused security assessment to find GraphQL injection vulnerabilities.
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

### Phase 1 — Recon: confirm GraphQL usage and find injection candidate sites

Read `references/sinks.md`. Part A: determine whether this codebase uses GraphQL at all
(dependencies, schema artifacts, mounted routes). Part B, only if GraphQL is used: search
for unsafe operation-document assembly sites (string concat/interpolation/format building
the query/mutation text). Record each candidate: `file:line`, the call pattern, and the
dynamic expression.

**Gate 1 — No GraphQL technology.** If GraphQL is **not used** in this codebase, write
`sast/graphql-results.md` with just `No GraphQL technology detected in this codebase.`
plus the Coverage section, and STOP — do not read `references/examples.md`.

**Gate 2 — GraphQL used but no candidates.** If GraphQL **is** used but you found zero
injection candidate sites, write `sast/graphql-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

Only proceed to Phase 2 if GraphQL is used AND at least one candidate site was found.

### Phase 2 — Verify: trace user input to injection candidate sites
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the dynamic part of the operation document. Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/graphql-results.md` using the output format below.

## Output format

```markdown
# GraphQL Injection Analysis Results: [Project Name]

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
- **If Phase 1 finds no GraphQL technology, skip Phase 2 and Phase 3** — write the "No GraphQL technology detected" results file.
- **If GraphQL is used but Phase 1 finds no injection candidates, skip Phase 2 and Phase 3** — write "No vulnerabilities found" (empty Findings).
- **Phase 1 does not trace taint**; Phase 2 does.
- Resolver-layer SQL/NoSQL issues belong to other skills; this skill targets **operation document** construction, not resolver argument handling.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide.

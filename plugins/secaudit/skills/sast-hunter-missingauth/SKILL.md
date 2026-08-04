---
name: sast-hunter-missingauth
description: >-
  Detect missing authentication and broken function-level authorization
  vulnerabilities in a codebase using an inline three-phase method: recon (map
  endpoints and the role/permission system via references/sinks.md), verify
  (check auth/authz via references/examples.md), and merge (write results).
  Covers unauthenticated access and vertical privilege escalation (e.g.,
  regular user accessing admin-only functions). Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/missingauth-results.md. Use when asked to find missing auth, broken
  access control, or privilege escalation bugs.
---

# Missing Authentication & Broken Function-Level Authorization Detection

You are performing a focused security assessment to find missing authentication and
broken function-level authorization vulnerabilities. Work the method below **inline, in
this one context**: recon → verify → merge. Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 endpoints) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: map endpoints and the permission system
Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, build a
complete map of endpoints, their current auth/role posture, and the role/permission
system. Do not yet decide whether any endpoint is exploitable. Record each endpoint:
`file:line`, the route, the operation, and whether auth/role checks are present.

If you find zero endpoints worth flagging, write `sast/missingauth-results.md` with an
empty Findings section plus the Coverage section, and STOP — do not read
`references/examples.md`.

### Phase 2 — Verify: check authentication and authorization
For each endpoint, read `references/examples.md` for concept, vulnerability classes,
prevention patterns, vulnerable/secure comparisons, and the verify heuristics. Determine
whether authentication and, where needed, role/permission checks are actually enforced.
Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/missingauth-results.md` using the output format below.

## Output format

```markdown
# Missing Auth/Authz Analysis Results: [Project Name]

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
- Focus on **vertical privilege escalation** (user → admin) and **unauthenticated access**. Horizontal escalation (user A → user B's resource) is covered by the IDOR skill.
- Authentication (you are who you say you are) and authorization (you are allowed to do this) are separate concerns — check both.
- Middleware order matters: a middleware registered after the route handler will NOT protect the route.
- A missing auth or role check on one HTTP method (e.g., DELETE) is a full vulnerability even if GET is protected.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Pay attention to route grouping: a `use('/admin', adminRouter)` pattern protects all routes in `adminRouter`, but routes mounted outside that group are not protected.

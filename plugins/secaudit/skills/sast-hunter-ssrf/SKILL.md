---
name: sast-hunter-ssrf
description: >-
  Detect Server-Side Request Forgery (SSRF) vulnerabilities in a codebase using an
  inline three-phase method: recon (find outbound call sites via
  references/sinks.md), verify (taint analysis via references/examples.md), and
  merge (write results). Requires sast/architecture.md (run sast-analysis first).
  Outputs findings to sast/ssrf-results.md. Use when asked to find SSRF or
  server-side request forgery bugs.
---

# Server-Side Request Forgery (SSRF) Detection

You are performing a focused security assessment to find SSRF vulnerabilities. Work the
method below **inline, in this one context**: recon → verify → merge. Read the reference
files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 outbound call sites) to
> a subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find outbound network call sites

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag ANY call where the destination (URL, host, or
address) is dynamic — do not yet decide whether it is user-controlled. Record each
candidate: `file:line`, the call, and the destination argument.

If you find zero candidates, write `sast/ssrf-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: taint analysis
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the destination without an effective allowlist. Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/ssrf-results.md` using the output format below.

## Output format

```markdown
# SSRF Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any call site where the destination argument is dynamic (a variable, expression, or assembled string), regardless of whether user input flows there. Do not attempt to trace user input in Phase 1 — that is Phase 2's job.
- **Phase 2 is purely taint analysis**: for each site, trace the destination argument back to its origin. If it comes from a user-controlled source without an effective allowlist, the site is a real vulnerability.
- **Blocklists are not mitigations**: IP blocklists for private ranges and cloud metadata endpoints are easily bypassed. Always record such sites as a `[FINDING]` with at least `**Confidence:** medium`, not as safe.
- **Partial URL control is still dangerous**: even if the attacker only controls the path or query string portion of the URL, record it as a `[FINDING]` with `**Confidence:** medium` — depending on the HTTP client behavior, redirect following, and target service, partial control can be enough.
- **Stored destinations are tainted**: if a URL or hostname was accepted from user input at write time and is later used for an outbound request, trace the write-time acceptance. Lack of allowlist validation at write time makes it SSRF.
- **Subprocess curl/wget is SSRF too**: shell-outs that run `curl` or `wget` with a user-supplied URL are just as dangerous as HTTP client calls. Check for these, especially in image-processing, import, or download features.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- DNS rebinding note: for findings where only a DNS-resolution-then-blocklist check is present, note the TOCTOU window explicitly in the finding — this is a known bypass technique.

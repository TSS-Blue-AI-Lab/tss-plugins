---
name: sast-hunter-xss
description: >-
  Detect Cross-Site Scripting (XSS) vulnerabilities in a codebase using an inline
  three-phase method: recon (find HTML/JS/DOM sink sites via references/sinks.md),
  verify (taint analysis via references/examples.md), and merge (write results).
  Requires sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/xss-results.md. Use when asked to find XSS or cross-site scripting bugs.
---

# Cross-Site Scripting (XSS) Detection

You are performing a focused security assessment to find Cross-Site Scripting
vulnerabilities. Work the method below **inline, in this one context**: recon → verify →
merge. Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 sink sites) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find XSS sink sites

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag ANY dynamic variable passed to a dangerous
HTML/JS/DOM sink — do not yet decide whether it is user-controlled. Record each candidate:
`file:line`, the sink call, and the interpolated variable.

If you find zero candidates, write `sast/xss-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: taint analysis
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the sink without effective escaping or sanitization. Keep the real ones; drop
safe patterns.

### Phase 3 — Merge: write results
Write `sast/xss-results.md` using the output format below.

## Output format

```markdown
# XSS Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any dynamic variable passed to an HTML/JS/DOM sink, regardless of origin. Do not attempt to trace user input in Phase 1 — that is Phase 2's job.
- **Phase 2 is purely taint analysis**: for each sink found in Phase 1, trace the variable back to its origin. If it comes from a user-controlled source with no effective escaping, the site is a real vulnerability.
- Context matters: the same variable may be safe in one output context (HTML body with escaping) and dangerous in another (JavaScript string literal, URL attribute, or event handler attribute). Check the exact rendering context.
- Custom sanitization (homegrown regex stripping, blacklisting `<script>`, etc.) is **not** sufficient — record as a `[FINDING]` with `**Confidence:** medium`. Only DOMPurify with a strict config or equivalent allowlist library is acceptable.
- Stored XSS is easy to miss: trace the write path to confirm the field is user-supplied, then separately verify the read/render path lacks escaping. Both legs must be true for the vulnerability to be exploitable.
- DOM-based XSS lives entirely in client-side JavaScript: look for `location.*`, `document.referrer`, `event.data`, and other attacker-controlled properties flowing into DOM sinks without passing through the server.
- CSP headers reduce XSS exploitability but are **not** a fix — still flag the underlying injection point.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Angular's `DomSanitizer.bypassSecurityTrust*` methods are always suspicious — flag them whenever the argument is not a hardcoded constant.
- For JavaScript execution sinks (`eval`, `setTimeout` with string arg), even seemingly innocuous data (error messages, IDs) can be dangerous if an attacker can influence them.

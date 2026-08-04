---
name: sast-hunter-ssti
description: >-
  Detect Server-Side Template Injection (SSTI) vulnerabilities in a codebase using
  an inline three-phase method: recon (find template rendering sites that use
  dynamic strings via references/sinks.md), verify (taint analysis via
  references/examples.md), and merge (write results). Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/ssti-results.md. Use when asked to find SSTI or template injection bugs.
---

# Server-Side Template Injection (SSTI) Detection

You are performing a focused security assessment to find Server-Side Template Injection
vulnerabilities. Work the method below **inline, in this one context**: recon → verify →
merge. Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 candidates) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find template rendering sites using dynamic strings

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag any call where the template string argument is a
variable, concatenated string, or other non-literal value — do not yet decide whether it
is user-controlled. Record each candidate: `file:line`, the template engine, the
rendering call, and the dynamic argument.

If you find zero candidates, write `sast/ssti-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: taint analysis
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the template string argument without effective mitigation. Keep the real ones;
drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/ssti-results.md` using the output format below.

## Output format

```markdown
# SSTI Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any dynamic (non-literal) variable used as the template string argument. Do not attempt to trace user input in Phase 1 — that is Phase 2's job.
- **Phase 2 is purely taint analysis**: for each candidate, trace the dynamic template argument back to its origin. If it comes from a user-controlled source, the site is a real vulnerability.
- The critical distinction is **template string vs. template context**: user input passed as a *variable name/value* inside `render_template("page.html", user=input)` is safe. User input passed as the *template string itself* to `render_template_string(input)` is dangerous.
- **Second-order SSTI is easy to miss**: a "custom template" feature may let users store Jinja2/Twig syntax in the database. When that stored template is later loaded and rendered server-side without sandboxing, it's SSTI. Treat DB-read template strings as potentially tainted.
- **Thymeleaf fragment expressions**: in Spring Boot, if a controller returns a view name constructed from user input (e.g., `return "user/" + lang + "/view"`), Thymeleaf may process Spring EL expressions embedded in the path segment, enabling RCE. Flag any controller that builds a view name string using user-supplied values.
- **Blocklist filtering is not a mitigation**: attempts to strip `{{`, `}}`, `<%`, `%>` etc. from user input are routinely bypassed via encoding, alternate syntax, or nested expressions. Do not drop a finding solely because filtering is present — still record it as a `[FINDING]`.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Include engine-appropriate proof-of-concept payloads for every `[FINDING]` recorded. Payloads should first test with a math expression (e.g., `{{7*7}}`) to confirm template execution before escalating to RCE payloads.

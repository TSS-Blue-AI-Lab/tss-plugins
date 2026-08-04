---
name: sast-hunter-xxe
description: >-
  Detect XML External Entity (XXE) vulnerabilities in a codebase using an inline
  three-phase method: recon (find XML parsing sites without external-entity
  hardening via references/sinks.md), verify (trace user input to each site via
  references/examples.md), and merge (write results). Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/xxe-results.md. Use when asked to find XXE or XML injection bugs.
---

# XML External Entity (XXE) Detection

You are performing a focused security assessment to find XXE vulnerabilities in a codebase.
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

### Phase 1 — Recon: find vulnerable XML parsing sites

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag any XML parsing call that lacks explicit external
entity hardening — do not yet decide whether the input is user-controlled. Record each
candidate: `file:line`, the parser/library, the missing hardening, and the input variable.

If you find zero candidates, write `sast/xxe-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: trace user input
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the parser, and assess exploitability (reflected, blind OOB, or DoS). Keep the real
ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/xxe-results.md` using the output format below.

## Output format

```markdown
# XXE Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any XML parsing call that lacks explicit external entity hardening, regardless of where the input comes from. Do not attempt to trace user input in Phase 1 — that is Phase 2's job.
- **Phase 2 is purely taint analysis**: for each site found in Phase 1, trace the XML input back to its origin. If it comes from a user-controlled source, the site is a real vulnerability.
- **Parser defaults matter**: Java DOM/SAX, PHP SimpleXML/DOMDocument, and lxml all resolve external entities by default — they require explicit hardening. Python's `defusedxml` and Go's `encoding/xml` are safe by default.
- **Do not confuse `LIBXML_NOENT` with protection**: in PHP, `LIBXML_NOENT` **expands** entities into their values — it does NOT disable entity loading. Only `libxml_disable_entity_loader(true)` or `LIBXML_NONET` provides network-entity protection.
- **XInclude is a separate vector**: if `XIncludeAware` processing is enabled on Java parsers or `xi:include` is processed elsewhere, flag it separately — it can read local files without a classic `ENTITY` declaration.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Taint can flow indirectly: a file upload may be saved to disk in one handler, then parsed in another background job. Trace the full chain including asynchronous processing paths.
- Blind XXE (no output in response) is still exploitable via DNS or HTTP callbacks to attacker-controlled servers. Do not dismiss a finding just because the parsed XML is not echoed back.

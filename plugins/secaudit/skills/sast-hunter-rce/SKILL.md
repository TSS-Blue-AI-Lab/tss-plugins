---
name: sast-hunter-rce
description: >-
  Detect Remote Code Execution (RCE) vulnerabilities in a codebase using an inline
  three-phase method: recon (find dangerous execution sinks via references/sinks.md),
  verify (taint analysis via references/examples.md), and merge (write results).
  Covers OS command injection, eval-like sinks, and unsafe deserialization. Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/rce-results.md. Use when asked to find RCE, command injection, or unsafe
  deserialization bugs.
---

# Remote Code Execution (RCE) Detection

You are performing a focused security assessment to find Remote Code Execution
vulnerabilities. Work the method below **inline, in this one context**: recon → verify →
merge. Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 sinks) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find dangerous execution sinks

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag ANY dynamic variable passed to an OS command,
eval-like, or deserialization sink — do not yet decide whether it is user-controlled.
Record each candidate: `file:line`, the sink call, and the dynamic argument.

If you find zero candidates, write `sast/rce-results.md` with an empty Findings section
plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: taint analysis
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the taint-tracing heuristics. Trace whether attacker-influenced input
reaches the sink without effective mitigation. Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/rce-results.md` using the output format below.

## Output format

```markdown
# RCE Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any sink where a non-constant variable appears in a dangerous position, regardless of where that variable comes from. Do not trace user input in Phase 1.
- **Phase 2 is purely taint analysis**: for each sink found in Phase 1, trace the dynamic argument back to its origin. If it comes from a user-controlled source, the site is a real vulnerability.
- **For deserialization sinks**: any externally-controllable byte stream is dangerous — HTTP bodies, cookies, file uploads, WebSocket frames, queue messages. Be conservative and flag all deserialization sinks where data flow from an external source cannot be ruled out.
- **For OS command sinks**: `subprocess.run(["cmd", var])` with list form and no `shell=True` is NOT command injection — the argument is passed directly to the process without shell interpretation. Only flag when shell interpretation is possible (string command + `shell=True`, or `exec()`/`system()` equivalents).
- **For `eval`-like sinks**: there is almost no safe way to use `eval()` with user input. Any eval-like sink receiving external data should be recorded as a `[FINDING]` with `**Confidence:** high`.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.
- Taint can flow indirectly through middleware, helper functions, class attributes, and intermediate variables. Trace the full chain.
- Second-order RCE is possible: a value stored from user input may later be deserialized or evaluated in a different code path (e.g., a user-supplied config stored in DB and later `eval()`'d by a cron job).
- For Java deserialization: the presence of dangerous gadget libraries in the classpath (Apache Commons Collections, Spring Framework, etc.) determines exploitability. Flag the deserialization call; note any relevant libraries from `architecture.md`.

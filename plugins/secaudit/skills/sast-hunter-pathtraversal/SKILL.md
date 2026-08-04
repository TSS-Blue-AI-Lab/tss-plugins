---
name: sast-hunter-pathtraversal
description: >-
  Detect path traversal vulnerabilities in a codebase using an inline three-phase
  method: recon (find file-loading sinks with dynamic paths via references/sinks.md),
  verify (trace user input and mitigations via references/examples.md), and merge
  (write results). Requires sast/architecture.md (run sast-analysis first). Outputs
  findings to sast/pathtraversal-results.md. Use when asked to find path traversal,
  directory traversal, or file disclosure bugs.
---

# Path Traversal Detection

You are performing a focused security assessment to find path traversal vulnerabilities.
Work the method below **inline, in this one context**: recon → verify → merge. Read the
reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 sinks) to a subagent
> for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find file-loading sinks with dynamic paths

Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for those sink patterns. Flag any file-loading call whose path has a dynamic
component, regardless of origin — do not yet decide whether it is user-controlled.
Record each candidate: `file:line`, the sink call, and the dynamic expression.

If you find zero candidates, write `sast/pathtraversal-results.md` with an empty Findings
section plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: trace taint and check mitigations
For each candidate, read `references/examples.md` for concept, vulnerable/secure
comparisons, and the verify heuristics (Check A — is the path user-controlled; Check B —
is escape prevented by an effective mitigation). Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/pathtraversal-results.md` using the output format below.

## Output format

```markdown
# Path Traversal Analysis Results: [Project Name]

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
- **Phase 1 is purely structural**: flag any file-loading sink where the path has a dynamic component, regardless of origin. Do not attempt to trace user input in Phase 1 — that is Phase 2's job.
- **Phase 2 is taint analysis + mitigation review**: for each sink found in Phase 1, (a) trace the path variable back to its origin and (b) check whether an effective mitigation prevents escape from the intended directory.
- `os.path.join` and `path.join` alone do **not** prevent traversal — `os.path.join('/base', '../etc/passwd')` resolves to `/etc/passwd`. Only `realpath` + prefix check prevents this.
- Encoded traversal variants (`%2e%2e%2f`, `%252e%252e%252f`, `..%2f`, `%2e%2e/`) bypass naive string-match filters; only filesystem-level resolution (`realpath`) handles them reliably.
- `send_from_directory` in Flask is safe by itself (it calls `safe_join` internally) — do not flag it unless user input is also used as the *base directory* argument.
- Archive extraction (ZipSlip) is a path traversal variant: zip/tar entry names can contain `../` sequences. Flag any extraction that uses entry names as output paths without per-entry validation.
- Second-order traversal is possible: a filename stored in the DB from user input may later be used in a file read elsewhere in the codebase. Treat DB-read path values as potentially tainted and trace back to where they were written.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.

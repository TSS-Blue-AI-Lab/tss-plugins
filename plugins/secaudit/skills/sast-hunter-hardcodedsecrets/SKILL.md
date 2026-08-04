---
name: sast-hunter-hardcodedsecrets
description: >-
  Detect hardcoded sensitive data (API keys, access tokens, private keys, passwords,
  etc.) in publicly accessible code — frontend JavaScript, mobile apps, client-side
  bundles, and HTML templates — using an inline three-phase method: recon (find
  secret candidates via references/sinks.md), verify (confirm real secrets in public
  code paths via references/examples.md), and merge (write results). Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/hardcodedsecrets-results.md. Use when asked to find hardcoded secrets, leaked
  API keys, or exposed credentials.
---

# Hardcoded Secrets in Public Code Detection

You are performing a focused security assessment to find hardcoded sensitive data that is
exposed in publicly accessible code. Work the method below **inline, in this one context**:
recon → verify → merge. Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 candidates) to a
> subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Recon: find secret candidates
Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, scan the
codebase for the listed high-confidence patterns, variable-name assignment patterns, and
inline literals. Flag ALL potential secrets regardless of frontend/backend location — the
public-accessibility filtering happens in Phase 2. Record each candidate: `file:line`, the
secret type, and the detection method.

If you find zero candidates, write `sast/hardcodedsecrets-results.md` with an empty
Findings section plus the Coverage section, and STOP — do not read `references/examples.md`.

### Phase 2 — Verify: confirm real secrets in public code
For each candidate, read `references/examples.md` for the concept, the secret-type
catalog, and the verify heuristics: Question 1 (is it a real secret, not a placeholder or
test key) and Question 2 (is it in publicly accessible code — frontend, mobile, or
client-served files, vs. backend-only). Keep the real ones; drop safe patterns.

### Phase 3 — Merge: write results
Write `sast/hardcodedsecrets-results.md` using the output format below.

## Output format

```markdown
# Hardcoded Secrets Analysis Results: [Project Name]

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
- **The key distinction is public accessibility**: a hardcoded AWS key in a Django view is bad practice but NOT a finding for this skill (it's server-side). The same key in a React component IS a finding because it ships to the browser.
- **Trace the import chain when uncertain**: A file at `src/utils/config.ts` might be imported by both server and client code. Check who imports it. If ANY client-side code path imports it, the secrets are exposed.
- **Mobile apps are always public**: All source code in Android, iOS, React Native, Flutter, and Xamarin apps should be treated as extractable. APKs can be decompiled with `apktool`/`jadx`, IPAs can be inspected, JS bundles in React Native are plaintext.
- **Firebase client config is generally NOT a secret**: The standard Firebase client config (`apiKey`, `authDomain`, `projectId`, etc.) is designed for client-side use and protected by Firebase Security Rules. Only flag Firebase **admin/service account** keys or **server keys**.
- **Stripe publishable keys are NOT secrets**: `pk_live_*` and `pk_test_*` are designed for client-side use. Only flag `sk_live_*` and `sk_test_*` (secret keys).
- **`NEXT_PUBLIC_*`, `REACT_APP_*`, `VITE_*` env vars**: These are embedded into client bundles at build time. Only flag if the actual secret value is hardcoded in source code, not if it's read from an env var.
- **Redact secrets in output**: When showing code snippets, always partially redact the secret value (e.g., `AKIA****WXYZ`, `sk_live_****abcd`). Never write the full secret value in the results file.
- When in doubt about public accessibility, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.

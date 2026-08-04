---
name: sast-hunter-jwt
description: >-
  Detect insecure JWT (JSON Web Token) implementations in a codebase using an
  inline two-phase method: first map the JWT lifecycle — issuance and
  verification sites, signing configuration — via references/sinks.md, then
  check each verification site for exploitable weaknesses (algorithm
  confusion, missing signature verification, weak secrets, header injection,
  missing claim validation) via references/examples.md. Requires
  sast/architecture.md (run sast-analysis first). Outputs findings to
  sast/jwt-results.md. If no JWT usage is found in Phase 1, Phase 2 is
  skipped. Use when asked to find JWT, token forgery, or authentication
  bypass bugs.
---

# JWT Vulnerability Detection

You are performing a focused security assessment to find insecure JSON Web Token (JWT)
implementations. Work the method below **inline, in this one context**: map the lifecycle
→ analyze verification sites. Read the reference files as each phase directs.

**Prerequisites**: `sast/architecture.md` must exist. Run the analysis skill first if it doesn't.

> **References** live in this skill's own `references/` directory. Address them as
> `references/<file>.md`, resolved relative to THIS SKILL.md — never relative to your
> working directory, and never with a `.claude/` or `.agents/` prefix.

> **Parallelism (optional).** By default do every phase yourself in this context — do
> NOT spawn subagents. Only if you are running this skill standalone AND nothing upstream
> is already parallelizing, you MAY dispatch each verify batch (~3 verification sites) to
> a subagent for speed. When invoked as one stage of a larger pipeline, ignore this and run inline.

## Method

### Phase 1 — Map the JWT lifecycle
Read `references/sinks.md`. Using the tech stack in `sast/architecture.md`, search the
codebase for JWT issuance sites, verification sites, token extraction, signing
configuration, and claim usage. This is purely discovery — do not assess security yet.

If JWT is **not used** anywhere in the codebase (no issuance or verification sites found),
write `sast/jwt-results.md` with:
```markdown
# JWT Analysis Results

No JWT usage detected in this codebase.
```
and STOP — do not read `references/examples.md`.

### Phase 2 — Analyze verification sites for vulnerabilities
For each verification site found in Phase 1, read `references/examples.md` for concept,
vulnerable/secure comparisons, and the per-check verify heuristics (algorithm restriction,
signature verification, secret strength, JWK/JKU/kid header injection, claim validation,
revocation). Do not search for new sites — focus on what Phase 1 found. Write final results
to `sast/jwt-results.md` using the output format and finding fields shown in
`references/examples.md`, ending with:

```markdown
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
- **Phase 1 is purely discovery**: locate every JWT issuance, verification, and configuration site. Do not attempt to assess security in Phase 1 — that is Phase 2's job.
- **Phase 2 is purely analysis**: for each verification site found in Phase 1, systematically check every vulnerability class. Do not search for new sites in Phase 2 — focus on what Phase 1 found.
- If no JWT usage is found in Phase 1, skip Phase 2 entirely and write a "No JWT usage detected" result file.
- The most critical checks are: signature verification disabled, algorithm not restricted (alg:none / RS256→HS256 confusion), and weak or hardcoded HMAC secret. These lead directly to full authentication bypass.
- `jwt.decode()` in Node.js's `jsonwebtoken` library is a decode-only function — it never verifies the signature. Only `jwt.verify()` validates the signature. Confusing the two is a common and critical mistake.
- In Python's PyJWT, versions before 2.0 accepted `alg: none` by default and did not require an `algorithms` parameter. If the codebase does not pin the version or restrict algorithms, flag it.
- Algorithm confusion (RS256→HS256) requires: (a) the server uses RS256 with a key pair, (b) the public key is accessible, and (c) the verification code does not restrict the algorithm. All three must be present.
- `kid` injection is often overlooked: always check how the key lookup is implemented when `kid` is present in the token header.
- When in doubt, still record it as a `[FINDING]` with `**Confidence:** low` — never drop it. Downstream Challenge/Trace decide; false negatives are worse than false positives.

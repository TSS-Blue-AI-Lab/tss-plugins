---
name: cold-read
description: Use after superpowers brainstorming writes a spec, or before a written plan is executed, when the user wants fresh agents to challenge it — "cold read", "devil's advocate", "red-team the plan", "challenge the spec", "poke holes in this". Not for small changes.
version: 1.0.0
---

# Cold Read

Fresh reviewers read a spec or plan cold, with no conversation, and you resolve what they find without stopping. The user knows the main ideas but has not read every line, and will read the document once, after you finish. So fix what you can, decide what you must, mark every decision you took for them, and leave the document consistent.

Siblings: superpowers' builder check asks *what is missing*; cold-read asks *what is wrong or misread*. `grilling` and `interview-me` question the user, cold-read questions the document. Never invoke a sibling automatically.

## Constraints

- **Reviewers are read-only** and start fresh every round: new agents, never resumed ones. They may run commands that change nothing, such as the existing tests.
- **No subagents, no cold read.** If the harness cannot dispatch them, say so and stop: a review in this context is not cold.
- **Never execute the plan.** You edit the document under review and nothing else.
- **Ask nothing until the end.** A question for the user becomes an assumed decision in the document. Your only message to the user is the closing one.

## Full read (once)

1. **Brief.** Read `references/reviewers.md` and dispatch Paraphrase, Critic and Reality in parallel. Give each the document path and the source files the document names. Never pass the conversation or your own suspicions.
2. **Verify and grade.** Check every finding's load-bearing claim yourself (read the code, run the test). The severity is yours, not the reviewer's: anything that makes a step fail or a goal unmet is at least Major, whatever the reviewer called it.
3. **Classify** every finding into the ledger below.
4. **Apply** every FIX, and write every DECIDE into the document as an assumed decision.

## Re-read the edits

Edits made under review break things: a fix that contradicts another section, a new test that cannot fail. After applying, dispatch one fresh reviewer with the Edits brief from `references/reviewers.md`, given every section you edited, including those an assumed decision changed. Verify, grade, classify and apply its findings the same way.

## The ledger

Keep it in your working notes, not in the document. One row per finding, every field required:

| Field | Content |
|---|---|
| Finding | reviewer, severity, location, one line |
| Goal | the stated goal or constraint it threatens, or the document's own stated reason for that part, quoted — or `none` |
| Class | CONTEST, DECIDE, FIX or DECLINE |
| Evidence | what decides the class (below) |

- **FIX** — the finding is true and threatens a stated goal. Evidence: what you verified. The edit is the smallest one that removes the threat. When the threatened part is something the document added on its own, not a goal or constraint the user stated, the smallest edit is usually deleting it: delete it, and record the deletion as a DECIDE so the user can bring it back.
- **CONTEST** — the finding is false. Evidence: a file, symbol, test output or document line the reviewer could have read. "It was intentional" is not evidence.
- **DECIDE** — the answer is outside every file the reviewers could read, or the finding is a true Blocker or Major but `Goal` is `none` (a scope question), or the fix changes what gets built rather than how. Apply the option you would recommend.
- **DECLINE** — a Nit by your grade: you checked that nothing fails without the change. Never a finding about security, data loss or access control: those are FIX or DECIDE.

You wrote or approved this document. Wanting to contest is not evidence that the reviewer is wrong. A paraphrase that gets the document wrong is never contested: the document failed to say it.

## Assumed decisions

Each DECIDE appears in the document twice:

- **Inline**, where it applies: `> **Assumed (D2):** <what the document now says>. Alternative: <the other option>.`
- **In `## Open decisions`**, a section near the top, numbered D1, D2 and so on. Each entry gives: one plain sentence on what this part is and why it exists (the user may not know it is in the document), the default you applied, the alternative, and what changes if they flip it. Name no reviewers.

The alternative is something this document would build. "Do it later" or "plan it separately" is not an alternative; it is the default of leaving it out.

If the section already exists from an earlier run, continue its numbering. In the closing counts, a deletion recorded as a DECIDE counts only as a decision.

## Stopping

- **Settled** findings stay settled: contested, declined and decided. A re-read raising one again does not reopen it.
- **Fixed** findings do not settle. Raised again at the same place, the fix failed: reopen it.
- **Stop** when a re-read finds no Blocker or Major, or when you made no edits.
- **Cap** at two re-reads. Apply the last round's findings, and list those edits under `Not re-read:` at the end of `## Open decisions`.
- Do not run a second full read. A fresh reader of unchanged text finds different gaps every time; chasing them never converges.

## Closing message

One message, your only one:

1. `cold-read finished: N fixed, M contested or declined, K decisions assumed.`
2. The decisions, one line each: `D1 — <question>: assumed <default> (alternative: <option>)`.
3. "Answer by number, or keep the defaults. They are marked in the document, so you can read it first."

Do not start the next step. The user answers when ready.

## Builder check

If the document came from superpowers brainstorming, its builder check has run and its small calls are marked as the author's. Treat those as settled: findings that only dispute such a call get no ledger row. If no builder check ran (for example, a plan from `superpowers:writing-plans`) and superpowers is installed, add its `builder-check-prompt.md` as a fourth reviewer in the full read; its questions become DECIDE rows.

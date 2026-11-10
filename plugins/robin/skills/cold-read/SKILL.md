---
name: cold-read
description: Use after superpowers brainstorming writes a spec, or before a written plan is executed, when the user wants fresh agents to challenge it — "cold read", "devil's advocate", "red-team the plan", "challenge the spec", "poke holes in this". Not for small changes.
version: 1.0.0
---

# Cold Read

Fresh reviewers read a spec or plan cold, with no conversation, and you answer what they find. Finding problems is the easy half: agents already do it well. This skill exists for the other half — deciding what each finding deserves without accepting everything, re-reading after the edits, and stopping on evidence.

Siblings: superpowers' builder check asks *what is missing*; cold-read asks *what is wrong or misread*. `grilling` and `interview-me` question the user, cold-read questions the document. Never invoke a sibling automatically.

## Constraints

- **Reviewers are read-only** and start fresh every round: new agents, never resumed ones. They may run commands that change nothing, such as the existing tests.
- **No subagents, no cold read.** If the harness cannot dispatch them, say so and stop: a review in this context is not cold.
- **Never execute the plan.** You edit the document under review and nothing else.
- **Every question carries a recommendation**, one question at a time.

## Full read (once)

1. **Brief.** Read `references/reviewers.md` and dispatch its three reviewers in parallel. Give each the document path and the source files the document names. Never pass the conversation or your own suspicions.
2. **Verify and grade.** Check every finding's load-bearing claim yourself (read the code, run the test). The severity is yours, not the reviewer's: anything that makes a step fail or a goal unmet is at least Major, whatever the reviewer called it.
3. **Classify** every finding into the ledger below.
4. **Settle with the user.** Show the ledger. Ask once whether to apply all FIX edits, recommending yes. Then put each ESCALATE to the user, one at a time.
5. **Apply** the approved edits to the document.

## Re-read the edits

Edits made under review break things: a fix that contradicts another section, a new test that cannot fail. After applying, dispatch one fresh reviewer with the Edits brief from `references/reviewers.md`, given the list of edited sections. Verify, grade, classify and settle its findings the same way, then apply.

## The ledger

One row per finding, every field required:

| Field | Content |
|---|---|
| Finding | reviewer, severity, location, one line |
| Goal | the stated goal or constraint of the document it threatens, quoted — or `none` |
| Class | CONTEST, ESCALATE, FIX or DECLINE |
| Evidence | what decides the class (below) |

- **FIX** — the finding is true and threatens a stated goal. Evidence: what you verified. The edit is the smallest one that removes the threat.
- **CONTEST** — the finding is false. Evidence: a file, symbol, test output or document line the reviewer could have read. "It was intentional" is not evidence.
- **ESCALATE** — the answer is outside every file the reviewers could read, or the finding is a true Blocker or Major but `Goal` is `none`. A problem that threatens no stated goal is a scope question, and scope is the user's: ask whether it joins this document or becomes a follow-up.
- **DECLINE** — a Nit by your grade: you checked that nothing fails without the change. Record it, change nothing.

You wrote or approved this document. Wanting to contest is not evidence that the reviewer is wrong. A paraphrase that gets the document wrong is never contested: the document failed to say it.

## Stopping

- **Settled** findings stay settled: contested, declined, and escalated-then-answered. A re-read raising one again does not reopen it.
- **Fixed** findings do not settle. Raised again at the same place, the fix failed: reopen it.
- **Stop** when a re-read of the edits finds no Blocker or Major, or when you made no edits.
- **Cap** at two re-reads. At the cap, list what is still open by severity and ask one question: accept and proceed, re-read again, or return the document to drafting.
- Do not run a second full read. A fresh reader of unchanged text finds different gaps every time; chasing them never converges.

## Builder check

If the document came from superpowers brainstorming, its builder check has run and its small calls are marked as the author's. Treat those as settled. If no builder check ran (for example, a plan from `html-plan`) and superpowers is installed, add its `builder-check-prompt.md` as a fourth reviewer in the full read.

---
name: interview-me
description: Interview the user one question at a time to resolve ambiguities in a plan or design, ranked by blast radius. Use when the user says "interview me", "grill me", or asks what is still ambiguous.
version: 1.0.0
---

# Interview Me

Takes a plan, design, or half-formed idea and interrogates the user until the decisions that matter are made. Output is a decision record.

Siblings: `blindspot-pass` is for *"I don't know this territory"*, `strawman` for *"I'll know it when I see it"*. This one is for *"I've brainstormed, my plan still has holes"*.

If another one fits the situation better, say so in one line and let the user decide. Never invoke a sibling automatically and never chain into one.

Read `gotchas.md` before starting.

## Constraints

- **One question at a time.** Every question carries a recommended answer and the reason for it, alongside the alternatives, so the user can accept one or write their own. Batching questions is bewildering and produces shallow answers.
- **Never ask what can be looked up.** Facts are read from the codebase, the artifact, or the environment. Only *decisions* go to the user. A question the user can answer only by checking a file is a failure of Phase 2.
- **Rank before asking.** No question leaves the queue without an impact rating. Unranked questions default to asking the most recently thought-of thing, which is not the most important thing.
- **Re-rank after every answer.** An answer settles some downstream questions and makes others load-bearing. The queue is rebuilt each turn, not walked in fixed order.
- **Never invent ambiguity.** If nothing high-impact is unresolved, say so and stop. A manufactured question wastes a turn and teaches the user to distrust the rest.
- **Don't act.** No code, no implementation plan, no starting the work. The skill ends at the decision record.

## Phase 1 — Source

Default source is the conversation so far — the brainstorm that just happened.

If the user names a file (spec, plan, design doc, notes), read it; it becomes the primary source and the conversation becomes secondary context.

If there is neither — no brainstorm in the conversation, no artifact — ask what the subject is before going further, recommending whatever the user's phrasing implies.

Note the user's stated priority axis if they gave one ("prioritize questions where my answer would change the architecture"). It overrides the default ranking in Phase 3.

## Phase 2 — Recap and lookup

Two things, in this order:

**Recap.** State what is already settled, in 150 words or less, and end with an explicit invitation to correct it. A wrong premise here shapes every question that follows, so this gate is worth one turn. Keep it to decisions, not a retelling of the conversation.

**Lookup.** Resolve every question that has a factual answer — read the artifact, the code, the config, the history. Use read-only agents if the sweep is wide enough to be worth parallelising. Anything a lookup answers is removed from the queue before the interview starts, and is mentioned only if it contradicts something the user assumed.

## Phase 3 — Build the queue

Enumerate the ambiguities, then rank each one. Read `references/question-sources.md` for where ambiguity hides and how blast radius is judged.

Print **counts only** — `6 high, 11 low` — never the list. A printed list invites batch answers, which is the failure mode this skill exists to avoid.

## Phase 4 — Interview

Work the high tier first, one question per turn. After each answer:

1. Record the answer and what it settles.
2. Re-rank the remainder. Drop what the answer just resolved. Promote what it just made load-bearing.
3. Ask the next highest.

Dependencies come before dependents: a question whose relevance depends on an unanswered question is not ready to ask.

"I don't know" is a legitimate answer. Record it as open and move on — do not re-ask it from a different angle.

When the high tier empties, report the state and stop unless the user says continue:

> 4 resolved. 9 low-impact questions left — keep going?

## Phase 5 — Close

Print the decision record in the format defined by `references/decision-record.md`, then ask where it should live.

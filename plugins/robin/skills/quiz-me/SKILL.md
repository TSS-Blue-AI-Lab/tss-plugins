---
name: quiz-me
description: Explain a finished change and quiz the user on it until they can prove they understand it. Use when the user says "quiz me", "quiz me on this change", or wants to verify they understand what happened in a session before merging. Also use after a branch review passes.
version: 1.2.0
---

# Quiz Me

Takes a finished change and produces a single self-contained HTML file: a report explaining what happened and why, followed by a quiz the user must pass before merging.

The premise: reading the diff gives a shallow understanding, because most of the change's behaviour lives in code the diff never touched. The report supplies the missing context; the quiz proves it landed.

Siblings run before implementation — `blindspot-pass`, `strawman`, `interview-me`. This one runs after. If the user actually wants one of those, say so in one line and let them decide. Never invoke a sibling automatically.

Read `gotchas.md` before starting.

## Constraints

- **Read-only on the code.** Never edit source, never commit, never merge. The only file written is the HTML report.
- **Never fabricate.** Every claim in the report carries evidence — `file:line`, commit, or PR. Inference is labelled `[INFERRED]`. What could not be determined is labelled `[ASK A HUMAN]` rather than guessed.
- **Every quiz question has a verifiable answer in the change set.** No general-knowledge questions, no trivia about the language or framework. If the answer isn't provable from the code or docs gathered in Phase 1, cut the question.
- **The report must be sufficient.** Every answer is derivable from the report above it. The quiz tests comprehension of the report, not recall of things never stated.
- **Pass means 100%.** No partial pass, no "close enough". The user's rule is that they merge only on a perfect score.
- **Don't decide the merge.** The skill ends at the HTML file. No offer to merge, no offer to start follow-up work, no suggested next prompt.
- **Every question to the user carries a recommendation.** When asking the user anything, ask one question at a time with a recommended answer alongside the alternatives.

## Phase 0 — Scope the change set

Establish exactly what is being quizzed:

| Scope | When |
|-------|------|
| Branch | Default. `git diff <base>...HEAD` plus every commit on the branch. |
| Working tree | Uncommitted work — staged and unstaged. |
| Named range | The user gives commits, a PR, or a tag range. |

Infer the base branch rather than assuming `main`. If scope is genuinely ambiguous, ask once, recommending what you inferred.

If the change set is empty, say so and stop.

## Phase 1 — Gather

Collect, in this order:

1. **The diff and the commit messages.** Commit messages carry intent the diff doesn't.
2. **The implementation notes, if they exist** — `docs/superpowers/notes/<plan-basename>-notes.md`, or `<branch>-notes.md` when the work had no plan file. Deviations and decisions recorded during implementation are the highest-value material in the whole gather — they are exactly what a diff cannot show. Same for any plan or spec doc the change was built from.
3. **Review output**, if a branch review or code review already ran in this session. Anything it flagged and the user accepted is a decision worth quizzing.
4. **The conversation so far**, if the implementation happened in this session.

## Phase 2 — Trace into unchanged code

This phase is what separates the report from a diff summary, and it is where most of the work goes.

For each changed entry point, trace what it now does *through code the diff did not touch*: who calls it, what it calls, which existing branch it lands in, what defaults and config it inherits, what it makes unreachable.

Dispatch read-only research subagents in parallel, one per changed subsystem or per entry point when the change is narrow. Use a read-only or explore-type agent if the harness provides one, otherwise a general-purpose agent. Each brief names one changed thing and asks for the surrounding machinery, with `file:line` evidence.

Look specifically for:

- Behaviour that changed in a file the diff never mentions.
- An existing guard, cache, retry, or default that now applies — or no longer does.
- A path that is now dead, or one that is now reachable for the first time.
- A decision in the implementation notes whose consequence only shows up in unchanged code.

## Phase 3 — Draft report and quiz

Write the report first, then build the quiz from it. Building the quiz first produces questions the report doesn't support.

Structure the report however this particular change is best explained — the shape depends on whether it is one deep path or ten shallow ones, and a fixed template fights that. What the report owes the reader, regardless of shape:

- Behaviour before implementation. What the change *does*, in plain language, before any file name appears.
- The reasoning behind each real decision, with the alternative that was rejected. Every decision and deviation recorded in the implementation notes, a plan, or a spec earns a place here — that material is the whole reason a diff is not enough.
- One end-to-end walk of a real request, naming each hop with `file:line` and marking which hops are **unchanged code**. Those hops are the intuition the diff cannot give.
- The behaviour a reasonable person would guess wrong, from Phase 2, each paired with the false assumption it breaks.
- What was left undone or deliberately simplified, including anything a review flagged and the user accepted.
- Evidence on every claim. `[INFERRED]` where it is reasoning, `[ASK A HUMAN]` where it could not be determined.

Read `references/question-design.md` for question rules, distractor rules, grading, and the page mechanics the quiz depends on.

## Phase 4 — Deliver

The page itself is the same either way: one self-contained document, inline CSS and JS, no external requests. Only where it lands differs.

**Preferred — publish as an artifact.** If the harness has an artifact or hosted-page tool, use it:

1. Read the harness's artifact design skill first if one exists. Follow whatever its tool requires — title, description, favicon.
2. Write the page to a file, then publish it.
3. **Ask before publishing**, once, and say plainly what is being sent: publishing uploads the change's file paths, code excerpts, and decisions to an external service. Wait for an answer. A private repo makes this the user's call, not a default.
4. Return the URL.

**Fallback — local file.** No artifact tool, or the user declines: write the HTML to the harness scratchpad or temp directory so nothing lands in the repo. Print the absolute path and the command to open it, then offer to move it into the repo if the user wants to keep it.

Either way, stop there. Do not summarise the report in chat and do not reveal any answer — a chat summary is a cheat sheet for the quiz that follows it.

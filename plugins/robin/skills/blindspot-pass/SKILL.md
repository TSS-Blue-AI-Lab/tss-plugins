---
name: blindspot-pass
description: Surface unknown unknowns before unfamiliar work. Use when the user says "blindspot pass" or "unknown unknowns", or says they don't know the codebase area or subject they're about to work in.
version: 1.0.0
---

# Blind Spot Pass

Maps unfamiliar territory and reports what the user does not know they don't know, before they start work. Output is a mental model plus a ranked list of blind spots.

This is a comprehension tool, not a planning tool. It ends at the report.

Siblings: `strawman` is for *"I'll know it when I see it"*, `interview-me` for *"my plan still has holes"*. If one of those fits better, say so in one line and let the user decide. Never invoke a sibling automatically and never chain into one — including after the report.

Read `gotchas.md` before starting.

## Constraints

- **Read-only.** Never edit files, never write files, never run mutating commands. The pass observes; it changes nothing.
- **Chat only.** The report is printed in the conversation and saved nowhere.
- **Never fabricate.** Every claim carries evidence — `file:line`, commit, PR, or URL. Inference is labelled `[INFERRED]`. What cannot be determined is labelled `[ASK A HUMAN]` rather than guessed.
- **"Why you'd miss it" is mandatory** on every blind spot. If that line cannot be written honestly, the item is a *known* unknown — drop it.
- **Stop at the report.** Do not produce a prompt to run next, do not offer to start the work, do not ask what to do now. The user takes it from there.
- **Every question carries a recommendation.** When asking the user anything, ask one question at a time and present a recommended answer alongside alternatives, so they can accept one or write their own.

## Phase 0 — Route

Decide what kind of unfamiliarity this is:

| Route | When |
|-------|------|
| `CODE` | The unfamiliar thing is a part of this codebase |
| `DOMAIN` | The unfamiliar thing is a subject, craft, or tool outside the repo |
| `BOTH` | The work needs an unfamiliar module *and* an unfamiliar subject — e.g. adding payments to a repo whose billing layer the user has never opened |

When genuinely ambiguous, ask, recommending the route you inferred.

## Phase 1 — Calibrate

A blind spot is relative to a person. The same fact is obvious to one user and invisible to another, so calibrate before investigating. Ask three questions, one at a time, each with a recommended answer drawn from what the user already said:

1. **The goal, concretely.** What are they trying to produce or decide?
2. **Familiarity with this area.** Never touched it / read some of it / have shipped in it before.
3. **What they already know, have already ruled out, or are constrained by.**

These answers set the floor. Never report as a blind spot something the user just said they know.

## Phase 2 — Investigate

Dispatch five parallel read-only research subagents, one per angle. Use a read-only or explore-type agent if the harness provides one, otherwise a general-purpose agent. `BOTH` runs both sets — ten agents.

Read `references/investigation-angles.md` for the angles and the brief each agent gets.

`DOMAIN` angles start from web research every time, including for subjects that feel stable. The user is asking precisely because they cannot tell which parts of their intuition are out of date.

## Phase 3 — Synthesize and filter

Merge the returns, then filter hard. Read `references/report-format.md` for filter rules and ranking.

The failure mode of this phase is a comprehensive tour of the territory. Relevance to the stated goal beats completeness every time.

## Phase 4 — Report

Print the report in the format defined by `references/report-format.md`. Then stop.

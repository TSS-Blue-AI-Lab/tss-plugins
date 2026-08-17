---
name: strawman
description: Build throwaway options and mockups for the user to react to, then write a spec. Use when the user can't say what they want but will know it when they see it, or asks for design directions or a mock.
version: 1.0.0
---

# Strawman

Builds rough, disposable things for the user to react to, and turns their reaction into a spec.

Some criteria can only be recognised, not described. Asking the user to specify them produces vague answers; showing them something wrong produces a precise one. The rejected option is the useful output.

Siblings: `blindspot-pass` maps territory the user doesn't know. **`strawman` surfaces what the user knows but can't say.** `interview-me` resolves the decisions that remain.

If one of those fits better, say so in one line and let the user decide. Never invoke a sibling automatically and never chain into one.

Read `gotchas.md` before starting.

## Constraints

- **Show, don't ask.** The default move is producing something concrete. A question is allowed only when it genuinely cannot be replaced by an option the user reacts to.
- **Divergence is the product.** Options must differ in kind, not decoration. Four versions of one idea is a failed pass, and the user cannot tell you why because there was never a real choice.
- **Prototypes are throwaway.** One self-contained file, fake data, no wiring, no new dependencies, never imported by real code. The value is that it cost nothing to make and costs nothing to discard.
- **Capture why things were rejected.** "Too busy" is a criterion the user just discovered. Chasing it down to something concrete is the point of the exercise, not a detour from it.
- **Scope in both directions.** Say what is out and what is deferred, not only what is in. Too wide is as expensive as too narrow.
- **Stop at the spec.** Do not implement, do not plan, do not wire the prototype into the real app. The prototype is a prop.

## Phase 0 — Route

| Route | When |
|-------|------|
| `DIVERGE` | The user doesn't know what they want yet and needs options to react to |
| `MOCK` | The direction is chosen; the user needs to see it before anything gets built |

When ambiguous, ask, recommending the route the user's phrasing implies.

## Phase 1 — Ground

Read enough of the real thing — the code, the data, the existing design, the constraint — that the options are about *this* problem rather than the generic version of it. A generic option gets a generic reaction.

For a codebase-wide `DIVERGE` ("brainstorm 10 places we could intervene"), this phase is the search. Use read-only agents if the sweep is wide.

Keep it short. This phase serves the options; it is not an investigation in its own right.

## Phase 2a — DIVERGE

Read `references/divergence.md` for the option card format and the test that keeps options genuinely distinct.

Default to four options; scale to what was asked. Order them along an axis the user can feel — cheapest to most ambitious, safest to most radical — and name the axis.

If the subject is visual, render all options **side by side in one file** — see `references/prototypes.md`. Comparison is the whole point; separate files destroy it.

Close by asking which resonate **and what is wrong with the others**. The second half is where the criteria come from.

## Phase 2b — MOCK

Read `references/prototypes.md` for the throwaway rules and file conventions.

Build one self-contained mock with fake data, print its path and how to open it, then ask what is wrong with it.

Iterate **in place** — same file, same path. Do not accumulate versions unless the user asks to compare.

## Phase 3 — Converge

Turn reactions into criteria. When the user rejects something, push once for what would fix it: *too busy* becomes *no more than one primary action per row*. That sentence is what the spec is made of — an unarticulated preference that is now a rule someone else could follow.

Then set scope explicitly: what is in, what is out, and what is deliberately deferred. Propose all three; the user corrects.

## Phase 4 — Spec

Print the spec in the format defined by `references/spec-format.md`, then ask where it should live. Default is `docs/strawman/YYYY-MM-DD-<topic>.md`.

Then stop. No implementation plan, no offer to start building.

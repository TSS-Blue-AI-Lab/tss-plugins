---
name: map
description: Route to the right robin skill. Use when the user wants a robin pass but doesn't know which one, or asks what these skills are for.
version: 1.0.0
---

# Map

Names what each robin skill is for and recommends one.

Recommends only. Never invoke the skill you point at, never chain into it, and never run a pass yourself. The user picks and invokes.

## Before implementation

| Skill | Use when |
|-------|----------|
| `blindspot-pass` | The user doesn't know the territory — an unfamiliar area of the codebase, or an unfamiliar subject. Ends at a ranked report of unknown unknowns. |
| `strawman` | The user can't say what they want but will recognise it. Builds throwaway options and mockups to react to. Ends at a spec. |
| `interview-me` | The user has a plan with holes. Questions one at a time, ranked by blast radius. Ends at a decision record. |

## During implementation

Nothing yet.

## After implementation

| Skill | Use when |
|-------|----------|
| `quiz-me` | The change is finished and the user isn't sure they understand it. Explains it, then quizzes them until they can prove it. Ends at an HTML report plus a must-pass quiz. |

## Routing

Match what the user is actually stuck on:

- *"I don't know this area"* → `blindspot-pass`
- *"I'll know it when I see it"* → `strawman`
- *"my plan still has holes"* → `interview-me`
- *"I don't really know what just got built"* → `quiz-me`

Starting cold, the natural order is blindspot-pass, then strawman, then interview-me — but that is an observation, not a pipeline. Most sessions need exactly one.

If none of them fit, say so plainly. A wrong recommendation costs more than no recommendation.

Give one skill, one line of reason, then stop.

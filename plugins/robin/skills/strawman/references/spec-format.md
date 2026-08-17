# Spec Format

One page. Long enough that a fresh session could pick it up, short enough that the user reads it now.

## Template

```markdown
# <Topic>

<!-- strawman, YYYY-MM-DD -->

## Problem

<Two or three sentences. What is actually wrong or missing, not the solution.>

## Direction

<The option that won, described concretely enough to build against. If it won with
 modifications, describe the modified version — not the original plus a list of edits.>

## Criteria

<The rules that came out of the reactions. One line each, phrased so someone else
 could apply them without having been in the room.>

- <e.g. No more than one primary action per row>
- <e.g. Empty state has to say what to do next, not just that there's nothing here>

## Scope

**In:** <what this covers>
**Out:** <what it deliberately does not cover>
**Deferred:** <what is worth doing but not now, and what would trigger doing it>

## Rejected

- **<Option name>** — <why it was rejected, in the user's terms>

## Open

<Decisions this pass could not settle. If none, say so in one line.>
```

## Section rules

**Criteria** is the section that justifies the pass. These are the things the user could not have written down before seeing something wrong. Write them as rules, not as impressions: "felt cluttered" is a reaction, "one primary action per row" is a criterion. If a reaction never got converted into a rule, it does not belong here.

**Rejected** is not a courtesy record. It stops the next session — or the next person — from re-proposing an option that was already killed, and it carries the reasoning that produced the criteria. Use the user's words where they were specific.

**Scope** always has all three fields filled. An empty `Out` means the scoping did not happen; propose something and let the user cut it.

**Open** feeds `interview-me` if the remaining decisions are substantial. Say so in one line — do not invoke it, do not start it.

## Then stop

Print the spec, ask where it goes, write it if the user wants it written. No implementation plan, no offer to build the real version.

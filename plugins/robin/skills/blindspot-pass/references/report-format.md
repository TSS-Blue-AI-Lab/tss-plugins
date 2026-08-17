# Report Format

## Filter first

Agent returns are raw. Most of what comes back does not belong in the report. Drop, in this order:

1. **Anything the user said they know.** Calibration answers are the floor.
2. **Anything that doesn't plausibly touch the stated goal.** Interesting ≠ relevant. Completeness is the failure mode of this skill.
3. **General good practice.** "Add tests", "read the docs", "watch out for edge cases" — a blind spot is specific to this territory or it isn't one.
4. **Anything where "why you'd miss it" cannot be written honestly.** If a reasonable person would have expected it, it is a known unknown, not a blind spot. This is the strictest filter and the one that carries the skill.

Then **merge**: the same fact arriving from three agents is one entry with three pieces of evidence, not three entries.

## Rank by cost if missed

Not by confidence, not by how interesting the finding is.

| Level | Meaning |
|-------|---------|
| `HIGH` | Silently wrong behaviour, substantial rework, or a security/data consequence |
| `MED` | Wasted effort, discovered later than it should have been |
| `LOW` | Friction — annoying, cheap to recover from |

## Structure

```
## Territory map

[Orientation, not inventory. The mental model a person needs before the blind
 spots below mean anything: what the pieces are, how they relate, how things
 flow through. 400 words maximum. Under budget is fine — this section exists to
 make the next one legible, not to be thorough.]

## Unknown unknowns   (showing top 7 of 12, ranked by cost if missed)

**1. [HIGH] <the claim, one line, stated as a fact>**
   Why you'd miss it:  <the false expectation — what a reasonable person would
                        have assumed instead, and why that assumption is wrong here>
   Cost if missed:     <what concretely goes wrong>
   Evidence:           <file:line, commit, PR, or URL>

**2. [HIGH] ...**

7 shown. 5 more found — ask for the rest if you want them.

## Questions only you can answer
1. <question>
2. <question>
```

## Section rules

**Territory map** — 400 words maximum. Orientation, not an inventory of everything found.

**Unknown unknowns** — top 7 only. If more survived the filter, the header shows the split (`showing top 7 of 12`) and a footer states how many are held back, so the user can ask for the rest. If 7 or fewer survived, drop both the split and the footer — no padding to reach seven, and no implying there is more when there isn't.

**Why you'd miss it** — the load-bearing line. It names the *false expectation*, not the fact. "The registry is compile-time" is the claim; "every other plugin system in this repo is runtime-loaded, so you'd reasonably assume this one is too" is why it's a blind spot. Without that second half the entry is documentation.

**Evidence** — required on every entry. `[INFERRED]` where the conclusion is reasoning rather than something read directly. `[ASK A HUMAN]` where it genuinely could not be determined — that is a legitimate finding, not a gap to paper over.

**Questions only you can answer** — the things investigation cannot resolve: intent, business constraints, whether a legacy path still matters, which tradeoff the user prefers. Five at most. If there are none, say so in one line rather than inventing some.

## Then stop

No suggested prompt. No offer to go deeper. No "what would you like to do next". The report is the deliverable.

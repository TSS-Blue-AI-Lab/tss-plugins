# Gotchas

Known failure points for this skill. **Update this file** whenever an interview goes wrong or hits a new edge case. Entries come from real failures only — never speculation.

## Format

- **What goes wrong**: description of the failure
- **Why**: root cause
- **Fix**: how to avoid or work around it

Timestamp each entry: `<!-- YYYY-MM-DDTHH:MM:SS -->`

---

## Source and recap

_No gotchas yet._

## Lookup

- **What goes wrong**: The interview accepted a capability the source artifact advertised that no task in the plan implemented or verified, and it survived into shipped documentation.
- **Why**: Lookup checked that claims were internally consistent, never that each claim had work behind it — an unbacked promise reads exactly like a settled decision.
- **Fix**: During Phase 2, list every capability the artifact promises a user and mark each as implemented / planned / unbacked; unbacked promises are either a queue item ("do we want this at all?") or a deletion, never a silent inheritance. <!-- 2026-08-04T00:00:00 -->

## Ranking

_No gotchas yet._

## Interview loop

- **What goes wrong**: A process/governance question framed in abstract terms ("edit policy", "drift guard") reads as overengineering and confuses the user.
- **Why**: The question described the mechanism instead of the concrete failure it prevents, and the answer was already implied by an earlier decision — it should have been auto-resolved with the obvious default, not asked.
- **Fix**: Phrase questions as the concrete scenario ("if you hotfix prod, the next release erases it — where do fixes go?"), and when an earlier answer implies an obvious default, record it and move on instead of asking. <!-- 2026-08-03T00:00:00 -->

- **What goes wrong**: On a port or migration, the first question was about verification methodology and the user replied that the scope itself was still cloudy.
- **Why**: The recap summarised the plan's own labels (phase names, gate names) instead of the concrete units of work the user pictured — the actual commits, files and diffs. A recap that repeats the artifact's vocabulary is not a shared premise.
- **Fix**: For port/migration/refactor sources, make Phase 2 produce a concrete work map first — enumerate the real commits or files, group them, and state per group what surrounding code must change. Ask nothing until that map is confirmed, and anchor every question to a named commit or file. <!-- 2026-08-03T00:00:00 -->

## Decision record

_No gotchas yet._

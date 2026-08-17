# Decision Record

The deliverable. Written so the user can hand it to someone else — or to a fresh session — and have the plan survive.

## Format

```
## Decided

1. <the question, one line>
   → <the answer, as decided>
   Settles: <what this locks in, and what it rules out>

2. ...

## Still open

- <question> — <skipped / user unsure / needs someone else / blocked on X>

## Changed by this session

- <a premise that was assumed before the interview and is now different>
```

## Section rules

**Decided** — one entry per question answered, in the order asked, so the dependency chain stays readable. `Settles` is the load-bearing line: it states the *consequence*, not a restatement of the answer. "Use Postgres" is the answer; "commits us to a migration step in deploy, rules out the embedded-DB option for local dev" is what it settles.

**Still open** — every question that did not get a decision, with why. "I don't know" is a legitimate outcome and belongs here, not quietly dropped. Include the low-impact tier as a count if the user chose to stop early: `9 low-impact questions not asked`.

**Changed by this session** — the premises that moved. What the user believed at the start of the interview and does not believe now, plus anything a Phase 2 lookup contradicted. This is the section that justifies having run the interview. Omit the whole section if nothing moved — never pad it.

## Then ask where it lives

One question, with a recommendation:

- **Write into the artifact** — recommended when the user pointed the skill at a spec or plan file. The decisions belong next to what they modify.
- **New file** — recommended when there was no artifact but the record is substantial.
- **Leave in chat** — for short sessions, or when the user is about to act on it immediately.

Do not write anything before the user answers. Do not offer to start the work.

# Reviewer briefs

Dispatch each with a read-only or explore-type agent if the harness has one, otherwise a general-purpose agent. Fill in `<DOC>` and `<SOURCES>`. Send the brief as written: adding your own suspicions anchors the reader and defeats the cold read.

Every reviewer returns findings in this shape, and may return `nothing load-bearing` instead:

```
- Severity: Blocker | Major | Nit
- Location: document line or section
- Claim: one sentence
- Evidence: document lines, file:line, or command output
```

## Paraphrase

```
You have never seen this project. Read <DOC>. You may read <SOURCES>.

First, restate the document in your own words, section by section: what will
exist when it is done, and for every rule it sets (a constraint, a source of
truth, a test assertion, an authority for some value) where that rule comes
from. Then walk every step, code block and test the document gives, and check
each one against the rules you restated.

Report the paraphrase first. Then report every place where two parts of the
document disagree, where a step breaks a rule the document set, or where you
could not restate a section — that last one is a Blocker. Skip questions about
missing detail and skip wording.
```

## Critic

```
You are the strongest opponent of this document. Read <DOC>. You may read
<SOURCES>.

For each decision it makes, give the strongest argument that it is wrong:
the failure mode it invites, the trade-off it accepts without saying so, the
simpler option it skipped. Every finding must name the evidence that makes it
more than a preference. If a decision holds up, say nothing about it.

Skip questions about missing detail and skip wording. If nothing you found
would change what gets built, answer `nothing load-bearing`.
```

## Edits

Used for every re-read after the full read. Fill in `<SECTIONS>` with the edited sections, by heading.

```
Read <DOC>. You may read <SOURCES>. These sections were just edited:
<SECTIONS>.

For each edited section: does it still agree with every other part of the
document that touches it, and does every step, code block and test in it work
against the repository? Read the code; you may run commands that change
nothing. A new test that would pass before the change it guards is a finding.
Do not review sections that were not edited, except where they touch an edit.
```

## Reality

```
Read <DOC>. Check it against the repository, not against your expectations.

For every file, module, function, field, route, command and test the document
names: does it exist, and does it behave the way the document says? Read the
code. You may run commands that change nothing, such as the existing tests.
Flag anything the document treats as present that is not, anything it says to
create that already exists, and any test whose expected result the real code
would not produce. Cite file:line or command output for every finding.
```

# Gotchas

Known failure points for this skill. **Update this file** whenever a quiz is too easy, a report is wrong, or a new edge case appears. Entries come from real failures only — never speculation.

## Format

- **What goes wrong**: description of the failure
- **Why**: root cause
- **Fix**: how to avoid or work around it

Timestamp each entry: `<!-- YYYY-MM-DDTHH:MM:SS -->`

---

## Scoping and gathering

- **What goes wrong**: The report and quiz cover only what the diff shows, so decisions taken during implementation are never tested.
- **Why**: Implementation notes, plan, and spec docs were not gathered, or were gathered and not mined. The decisions they record — deviations, rejected alternatives, accepted tradeoffs — leave no trace in the diff at all.
- **Fix**: If any implementation notes, plan, or spec exist for the change, every decision and deviation in them gets covered in the report's reasoning *and* at least one quiz question. Cite them as `file:line` like any other source.
<!-- 2026-07-31T00:00:00 -->

## Report

- **What goes wrong**: The "what a reasonable person would guess wrong" section headlines a hazard that is not one — unchanged code described as newly dangerous because its *surroundings* changed, when tracing it shows the behaviour is still correct in every real invocation.
- **Why**: The section rewards surprise, so a plausible-sounding consequence gets written up before anyone tries to name a concrete caller who is actually harmed. A shared helper is the typical victim: reading one call site suggests a trap that reading the helper itself disproves.
- **Fix**: Before a Phase 2 finding becomes a hazard, state the exact scenario — who runs what, standing where — and read the function that decides the behaviour end to end, not just its call site. No concrete harmed caller means it is background explanation, not a surprise. Prefer demoting to a plain factual paragraph over deleting: the mechanism is still worth explaining.
<!-- 2026-08-04T00:00:00 -->

## Question design

- **What goes wrong**: The quiz is passable without understanding the change, because the correct answer is always the longest and most detailed option.
- **Why**: Writing the correct answer first, in full, then padding out three short distractors. The right answer ends up carrying every qualifier and the reader pattern-matches on length instead of reasoning.
- **Fix**: Keep all four choices within a similar length band and count the characters to check. Vary which choice is longest across the quiz, and make the correct answer the shortest option on some questions.
<!-- 2026-07-31T00:00:00 -->

- **What goes wrong**: Questions are hard to read — coined vocabulary, nested clauses — so the reader spends the effort decoding the sentence instead of reasoning about the change.
- **Why**: The stem gets written in the report's own phrasing, which has already introduced every term the change invented. That reads as plain English to whoever just wrote the report and as jargon to everybody else, including the same person a week later.
- **Fix**: Give every question a two-sentence plain-language restatement, always visible, that defines the vocabulary and sets the scene without stating any mechanism. Write it after the four choices are final and check it against them for leakage — see "Plain-language restatement" in `references/question-design.md`.
<!-- 2026-07-31T12:00:00 -->

## HTML output

- **What goes wrong**: The report is dumped as a local HTML file the user has to open by hand, even in a harness that can publish a proper hosted page.
- **Why**: Phase 4 named a scratchpad path as the default and never mentioned the harness's artifact tooling, so the agent followed the letter of the skill and skipped a capability it had. A skill that hardcodes one output mechanism silently disables the better one.
- **Fix**: Name the capability, not the mechanism — "publish as an artifact if the harness has that tool, else write a local file". Confirm before publishing, since the page carries file paths and code excerpts out to an external service.
<!-- 2026-07-31T00:00:00 -->

- **What goes wrong**: The report avoids diagrams, or hand-draws ASCII where a rendered one was available.
- **Why**: A blanket "no CDN scripts" rule was read as "no mermaid". Artifact-hosted pages render mermaid natively from `<pre class="mermaid">` with no external script involved.
- **Fix**: State the actual constraint — no external requests — and let the delivery route decide the diagram form.
<!-- 2026-07-31T00:00:00 -->


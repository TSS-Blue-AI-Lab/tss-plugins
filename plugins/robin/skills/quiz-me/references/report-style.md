# Report Style

The reader is the person about to merge, reading cold, possibly a week later. They should be able to read the report from top to bottom without opening the code. Pictures carry the mechanisms. Words explain the pictures. Evidence is one click away, never in the way.

## Words

- **Lead with what the change does for the user.** One or two sentences before any file, class or function name.
- **Name things by their role**, such as "the adapter", "the tool desk" or "the claude program". Define each name once, where it first appears. A real identifier (class, function, module) goes in parentheses after the role name, or in the evidence block. It is never the subject of a sentence.
- **Keep paragraphs short**, one idea each. No `file:line` in body text.
- **Keep verbatim** only what the reader will actually meet: an error message, an env var, a command. Put each in `code`.
- **Cut jargon** that is not needed to answer a quiz question. Define the rest in passing.

## Pictures

Every section opens with a diagram, a chart or a card grid. The prose that follows explains it.

| Mechanism | Picture |
|-----------|---------|
| Who talks to whom, in what order | Sequence diagram: lifelines, numbered steps, a box for whoever is waiting |
| Old path vs new path, prod vs local | Two lanes side by side, with the difference highlighted |
| What is allowed and what is blocked | Fence: allowed items on one side, blocked items behind a wall |
| Timers, lifecycle, retries | Timeline with segments and markers |
| Pieces combined into one | Funnel: inputs → holder → single output |
| Settings, deferred items, who does what | Card grid with a status pill on each card (works / partly / ignored, open bug / deferred / known) |
| Decisions | One card each, with "Chose" and "Instead of" lines |

**Plots use real numbers only**: counts from logs or transcripts, measured costs, probe results. Draw bars to scale, say "bars to scale", and name the units. Never invent data for a chart. A mechanism diagram may use illustrative numbers only if it is labelled `ILLUSTRATIVE NUMBERS` in the drawing itself.

Mechanics:

- Inline `<svg>` with a `viewBox` about 720 wide, inside an `overflow-x: auto` container.
- Colours come from CSS classes bound to the page's theme tokens, never literals, so dark mode works.
- Text is 11.5–13.5px. Keep labels short and put sentences in the `<figcaption>`.
- Give every figure `role="img"`, an `aria-label` stating its claim, and a `<figcaption>`.
- After drawing, check that no label runs past its box or past the viewBox.

## Evidence

- Under each section, put a closed `<details class="code"><summary>Where in the code</summary>` block. It lists the `file:line` locations, commits and notes/plan/spec references behind that section's claims.
- The end-to-end walk the skill requires is drawn as the sequence diagram. Its hop-by-hop list, with `file:line` and **unchanged** / **changed** tags, goes in that section's evidence block.
- `[INFERRED]` and `[ASK A HUMAN]` stay visible next to the claim they qualify, as small tags.

## Navigation

- The header states the branch, the base, the commit count, HEAD and the date.
- Below it, a row of pill links points to every section anchor and to the quiz.

## Quiz wording

- Questions use the report's plain names, not internal identifiers. The exception is a question about the identifier itself, such as an env var.
- Each "Because" explanation is in plain words and ends with one `file:line` in parentheses.

## Fonts

System font stacks only. The page makes no external requests.

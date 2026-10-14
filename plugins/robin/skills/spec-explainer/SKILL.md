---
name: spec-explainer
description: Explain a written design spec as one HTML page of figures and short technical prose, for the user, a PM or a reviewer. Use when the user says "explain the spec", "spec as an artifact" or "make the spec readable", or wants a spec explained simply but technically.
version: 0.1.0
---

# Spec Explainer

Takes a finished design spec and produces one HTML page that someone can read in ten minutes and come away knowing what will be built, why, and what was rejected.

The premise: a spec is written to be complete, so it reads like a list of decisions. A reader needs the mechanism and the reasoning, and both come through in a picture with a few sentences of explanation. A figure on its own is not enough: the reader sees the data but not the conclusion drawn from it.

Runs after the spec is written (by `superpowers:brainstorming` or `strawman`) and before the implementation plan. It explains the spec and never changes it. Siblings: `html-plan` is for the implementation plan, and `quiz-me` runs after the change ships. If the user really wants one of those, say so in one line and let them decide. Never invoke a sibling automatically.

Read `gotchas.md` before starting.

## Input

- The spec path. If none is given, use the newest file in `docs/superpowers/specs/`. If there is none, ask.
- Everything the spec cites: probe results, measurements, code locations, external references such as laws, standards and docs. Read those sources, not just the spec's summary of them.

## Page shape

1. **Hero.** A one-sentence claim of what the change does, plus a 3–5 node flow of the whole mechanism.
2. **One section per load-bearing decision**, in the order the reader needs them: usually why, then what, then how it works, then what it costs, then who sees what, then rollout. Skip any the spec does not cover. Each section has:
   - an eyebrow (two or three words);
   - a headline that states the conclusion, not the topic ("Only one way keeps bare numbers out", not "Probe results");
   - a paragraph of 2–4 sentences: what was decided, why, and the main alternative that was rejected;
   - one figure;
   - a one-line caption that says what to take from the figure.
3. **Still open:** the spec's open items, verbatim. If it has none, say so.
4. **Sources** in a closed `<details>` block: the spec path and commit, the external references, the code locations.

Keep it to about 120 words of prose per section. If a section needs more, it is two sections.

**The headlines are the summary.** Read the eyebrows and headlines alone, top to bottom: they must tell the whole spec. Write them before any figure, and fix them first.

## Figures

Choose the figure by what the section claims:

| Claim | Figure |
|---|---|
| A flow or a branch | Flowchart: mermaid (`<pre class="mermaid">`) where the page host renders it, inline SVG otherwise |
| A comparison between options | Bar chart (inline SVG) |
| Scaling or a budget | Line or band plot, with the limit drawn on it |
| A distribution | Histogram |
| A rule that decides something | An interactive tester: input text plus presets, running the rule |
| What changes on disk or in the data | A file tree with deletions struck through |
| A contract or payload | The JSON, with comments |
| Who sees what | A table |

Every number in a figure must come from the spec, from a source the spec cites, or from a measurement taken for this page. A number you measure yourself is an aggregate and its source is named in the caption. If you can't ground a number, drop the figure. Never estimate a number just to fill a chart.

An interactive tester runs the rule exactly as the spec writes it. Its presets are synthetic: at least one input that passes, one that fails, and each edge case the spec names. If building it forces you to pick an interpretation, the spec is ambiguous: report that as a discrepancy.

## Rules

- **Explain, never edit.** If the page shows that the spec is wrong, ambiguous or out of date, report it in chat and leave the spec unchanged.
- **Sensitive data** (personal data, secrets, customer content) appears only as synthetic examples or counts. Examples must be clearly fake and valid for the rule they demonstrate.
- **Design.** If the harness has artifact or chart design guidance, load it before writing the page. Use colour tokens with dark-mode overrides, give `body` an explicit background, and make it work at phone width (wide charts scroll inside their card). The fonts must not be the generic AI defaults.

## Steps

1. **Read** the spec and every source it cites.
2. **Write the hero claim and the section headlines.** Read them aloud and fix them before going on.
3. **Build each section:** figure first, then paragraph and caption.
4. **Check every figure's numbers against its source.** A number rounded in conversation ("~10%") can be wrong in the spec's own data.
5. **Look at it.** If you can render the page headless, screenshot it in light mode at desktop width and in dark mode at phone width. Fix overlapping labels and clipped bars. If you can't render it, say in the output that the layout was not checked.
6. **Deliver.**
   - **Preferred: publish as an artifact**, if the harness has an artifact tool. Ask once before publishing and say what will be sent: the spec's decisions, code locations and measurements leave the machine. Wait for an answer.
   - **Fallback: local file.** No artifact tool, or the user declines: write the HTML to the harness scratchpad or temp directory, not into the repo unless the user asks. Print the absolute path.

## Output

In chat, after delivering:

- The artifact link or the file path.
- Every discrepancy found between the spec and its sources, or inside the spec. "None found" if there are none.
- The spec's review state as the spec records it, for example its `Status:` line, and whether the spec is committed. If the spec records no review state, say so. Never report it as approved on your own reading.

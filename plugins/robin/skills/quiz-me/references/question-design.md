# Question Design

The quiz exists to catch a false sense of understanding. A quiz that a person passes by skimming the report has failed at its only job.

## Count and mix

Eight to twelve questions. Fewer than eight leaves too much untested; more than twelve gets skimmed.

Cover, at minimum:

| Kind | Tests |
|------|-------|
| Trace | "A request arrives at X. Which path does it take now?" |
| Consequence | "What happens if the config value is absent?" |
| Decision | "Why was A chosen over B?" — one per significant decision |
| Unchanged code | "Which existing behaviour does this change silently alter?" |
| Blast radius | "Which other caller is affected by this?" |
| Deferred | "What was deliberately left undone?" |

**Every decision recorded in the implementation notes, a plan, or a spec gets at least one question.** Those decisions are invisible in the diff, so they are exactly what the user cannot have absorbed by reading it. A quiz that skips them tests the easy half of the change.

Weight the count toward whatever was most surprising in Phase 2, not evenly across files.

## Answer choices

Four choices per question. Rules, all of them load-bearing:

- **Similar length.** Measure them. The correct answer being the longest, most-qualified, most-detailed option is the single most common tell, and it lets a reader pass by pattern-matching instead of understanding. Vary which position is longest across the quiz; sometimes the correct answer should be the shortest.
- **Vary the correct position.** Do not let the answer key drift toward one letter.
- **Every distractor is what a reasonable person would actually believe** — usually the behaviour before the change, the behaviour the diff appears to imply, or the way a sibling module does it. A distractor nobody would pick reduces a four-choice question to three.
- **No absolutes as tells.** "Always" and "never" in a distractor and nowhere else gives it away.
- **No "all of the above", no "none of the above".** Both are gradeable by elimination.
- **One unambiguously correct answer.** If two could be defended, the question is broken — rewrite it, don't caveat it.

## Plain-language restatement

A question the reader has to decode twice tests reading comprehension, not understanding of the change. Every question carries a restatement of **the question itself** in plain terms — two sentences, no more — sitting under the stem and visible from the start.

This is not a licence to write opaque stems. Keep the stem as plain as precision allows; the restatement exists for the vocabulary the change itself introduced, which no amount of rewording removes.

**Its only job is to define the vocabulary and set the scene.** It says what the terms mean and which moment the question is asking about. It never says what happens, why it happens, or what follows from it.

Write it *after* the four choices are final, then check it against them:

- **No word from the correct choice**, and no synonym of one.
- **No causal language** — "because", "so that", "which means", "therefore". A restatement that explains a mechanism has answered the question.
- **Nothing that eliminates a distractor.** Rule one out and the question is now three-choice.
- **The leak test.** Could someone who has not read the report pick the right answer from the stem plus the restatement alone? Then it leaks. Rewrite it.

Worked example. The stem:

> Reserving a citation index range throws when no capture is active, rather than returning zero. Why?

A restatement that works — it defines "capture" and "index range", puts the reader at the moment being asked about, and claims nothing:

> When the model searches, the chunks that come back are held for the duration of that one request, and each is given a number the answer can cite. This asks about the code handing out those numbers when the holding area for the request is not there at all.

A restatement that leaks — the second clause *is* the correct choice:

> ...and returning zero would be indistinguishable from a legitimate first index.

Omit the restatement only when the stem is already one short sentence in ordinary words. A restatement of an already-plain question is filler, and filler teaches the reader to skip the ones that matter.

## Explanations

Every question — right or wrong — has an explanation revealed only after submit:

```
Correct: <the answer>
Because: <the mechanism, with file:line>
Covered in: <link to report section anchor>
```

Explain the mechanism, not the fact. "Because `resolve()` falls through to the cached default at config.ts:88" teaches; "because that's what the code does" does not.

## Grading

Pass is every question correct. On a failure the page prints the score, the wrong questions with their explanations, the report sections to re-read, and a retry button.

No hints before submit. No partial credit. No "you were close".

## Page mechanics

The report's shape is a judgement call. These are not — the quiz doesn't work without them.

- **Self-contained.** Inline `<style>` and `<script>`, no external requests. A local file must open from `file://`; an artifact runs under a CSP that blocks every external host. Inline JS works in both, so the grader is fine either way.
- **Report sections carry `id` anchors.** Wrong answers link back to the section that covers them, which is why anchors exist at all. Whatever sections the report ends up with, give each one an id.
- **Quiz sits below the whole report.** One `<form>`, radio inputs per question, one submit button.
- **Nothing revealed before submit.** Explanations, correct-answer marks, and the score live in elements hidden until the grade runs. A page that leaks the key on load is not a quiz.
- **Restatements are always visible.** Each sits under its stem and above the choices, styled apart from both, and is never hidden behind submit — a reading aid is not a hint.
- **Grade in JS on submit.** Score, per-question correct/incorrect, and for each wrong answer the explanation plus its anchor link.
- **Pass is 100%**, and anything less prints the sections to re-read plus a retry button that clears the form and re-hides the explanations.
- **Answer key lives in the page** as a JS array. Peekable by anyone reading source — accepted; the user is not trying to cheat themselves.
- **Readable in light and dark**, and legible printed. One `@media (prefers-color-scheme: dark)` block is enough. No frameworks, no build step.
- **Header states the change set** — branch, base, commit count — so the page still makes sense a week later and a shared URL explains itself.

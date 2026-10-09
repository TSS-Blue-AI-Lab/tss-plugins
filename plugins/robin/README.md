# robin — skills for the whole build

Skills for the whole build: before, during, and after implementation.

The sidekick. Superpowers does the work; robin makes sure you understand it — before you start,
and before you merge.

One canonical skill tree serves both supported clients, Claude Code and Codex. The
implementation-notes hook is Claude Code only — Codex has no hook system — and everything else
works identically in both.

Not affiliated with the superpowers project; the cross-platform hook wrapper is copied from it
(MIT, © 2025 Jesse Vincent — see [NOTICE](NOTICE)). `grilling` and `retro` come from Matt Pocock's
skills (MIT), and `html-plan` from Thariq Shihipar's plugin (MIT); NOTICE has the details.

## Skills

### Before implementation

- **`blindspot-pass`** — surfaces unknown unknowns before unfamiliar work. Read-only. Ends at a
  ranked report.
- **`strawman`** — builds throwaway options and mockups to react to, for criteria you can
  recognise but not state. Ends at a spec.
- **`interview-me`** — resolves remaining ambiguity one question at a time, ranked by blast
  radius. Ends at a decision record.
- **`grilling`** — the same job in rounds: every question answerable now, at once, each with a
  recommended answer. Fires on "grill me". Ends when nothing is left assumed.
- **`html-plan`** — writes the implementation plan as one interactive HTML page: a tree of
  claims, each proved by a mockup, state machine, call stack, schema or code, with your
  decisions placed where they matter. Ends when you paste back its response.

### During implementation

- **notes-rule hook (Claude Code only)** — no invocation needed. When a plan execution starts —
  you type `/superpowers:subagent-driven-development` or `/superpowers:executing-plans`, or
  Claude invokes either skill itself — the hook injects one rule: keep
  `docs/superpowers/notes/<plan-basename>-notes.md`, and when an edge case forces you off the
  plan, take the conservative option, log it under `## Deviations` as `### D<N>`, and keep going
  rather than stopping to ask. Re-injected after compaction, once per branch per session.
  `quiz-me` reads those Deviations afterwards, so the notes are what makes the quiz cover the
  decisions a diff cannot show.

  **Under Codex the hook never runs.** Codex has no hook system, so nothing is injected and the
  notes file is yours to keep by hand. Nothing breaks either way: `quiz-me` reads the notes if
  they exist, and when they don't it asks you what the quiz should cover before building it.

### After implementation

- **`quiz-me`** — explains a finished change with the context a diff can't give, then quizzes you
  on it. Ends at a self-contained HTML report with a must-pass quiz.
- **`retro`** — reviews a hard session and proposes fixes to the agent's environment: automated
  checks, navigation pointers, coding standards. Proposes only; nothing changes until you pick a
  candidate. User-invoked only: `/robin:retro`.

Not sure which one? Run `/robin:map` (Codex: `$robin:map`).

## Install

### Claude Code

```
/plugin marketplace add TSS-Blue-AI-Lab/tss-plugins
/plugin install robin@tss-plugins
```

Then `/reload-plugins`. Skills are invoked with the plugin prefix, e.g. `/robin:strawman`.

### Codex CLI

```
codex plugin marketplace add TSS-Blue-AI-Lab/tss-plugins
```

Then open `/plugins` and install `robin`. Skills are invoked as `$robin:strawman`.

### Codex desktop app

No CLI needed — the app has a UI for this:

1. Open **Plugins**, then **Create** → **Add Marketplace**, and add
   `TSS-Blue-AI-Lab/tss-plugins`.
2. Back in **Plugins**, open the **Personal** tab, find **robin** under **TSS Plugins**, and hit
   **Install**.

## Requirements

- Claude Code, or Codex. The skills are prose and the hook is pure bash with no dependencies and
  no install step.
- `node`, for `html-plan` only: its `runtime/pack.mjs` lints the plan and packs it into one
  offline HTML file. No npm install. Every other skill runs without it.
- The hook uses `git` to key its once-per-branch marker; outside a repository it falls back to a
  branch of `nobranch`. On Windows, Claude Code runs it through `hooks/run-hook.cmd`, which
  locates Git Bash — with no bash anywhere the wrapper exits silently and the plugin keeps
  working, minus the injection.

### Client capability differences

Both clients run the same skills. Two capabilities the skills use are not guaranteed everywhere,
and each degrades explicitly rather than silently:

- **Web access** — `blindspot-pass` researches the web for its `DOMAIN` angles. Codex ships with
  web search off by default; enable it in your Codex configuration. Without it, the pass says so
  and marks every domain finding `[ASK A HUMAN]` instead of answering from model memory.
- **Parallel subagents** — `blindspot-pass` and `quiz-me` fan out read-only researchers. Codex
  needs `[features] multi_agent = true` in `~/.codex/config.toml`. Without it the angles run
  sequentially in one session and the report says so.

## Layout

What ships when you install the plugin:

- `skills/` — the canonical skill tree both clients read: `blindspot-pass`, `strawman`,
  `interview-me`, `grilling`, `html-plan`, `quiz-me`, `retro`, `map`
- `hooks/` — `hooks.json`, the `notes-rule` script, and the `run-hook.cmd` polyglot wrapper
  (Claude Code only; inert under Codex)
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` — per-client plugin manifests
- `README.md` — this file
- `NOTICE` — third-party copyright notice, which must travel with every copy

Nothing else is packaged: tests, docs, and CI config live in this repository but are not part of
the plugin a user installs.

## Development

This repository (`tss-plugins`) is the development home for the plugin, not just its marketplace
host. Plugin content lives at `plugins/robin/`, its tests at `tests/robin/`. Run the suite with:

```
for t in tests/*/*.test.mjs; do node "$t"; done
```

The hook's own checks are plain bash and also run on their own:

```
bash tests/robin/test-notes-rule
```

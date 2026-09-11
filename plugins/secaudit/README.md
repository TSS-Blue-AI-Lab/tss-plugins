# secaudit — agentic code-audit framework

An installable plugin that runs a whitebox security audit of a source repository from inside a
coding agent. Seeded from [sast-skills](https://github.com/utkusen/sast-skills) (MIT, © 2026
Utku Sen — see [NOTICE](NOTICE)) and evolved in small versions; it implements the
Cloudflare "Project Glasswing" vulnerability discovery harness as a single-repo pipeline. Not
affiliated with or endorsed by Cloudflare.

One canonical skill tree serves both supported clients. Claude Code drives it with a
deterministic workflow; Codex drives the same skills with a portable prose runbook. Both share
the same stages, bounds, deterministic runtime, and artifact contract.

## Pipeline

Recon → Hunt → Challenge → Dedupe → Trace → Generate Artifacts

Optional: Challenge → Blindspot Sweep → Hunt → Challenge (a single replay, disabled by default).

One Hunter runs per selected vulnerability class; Challenge independently re-checks every new
finding; Trace judges reachability; Generate Artifacts validates structured report data and
publishes deterministic Markdown and HTML.

## Requirements

- **Node.js 22 or newer on PATH.** Neither client bundles a usable Node. The launcher
  preflights `node --version` and stops with an install message before doing anything else.
  Get it from https://nodejs.org.
- Claude Code, or Codex.
- No other dependencies: the deterministic runtime uses Node built-ins only and has no install
  step.

## Install

### Claude Code

```
/plugin marketplace add TSS-Blue-AI-Lab/tss-plugins
/plugin install secaudit@tss-plugins
```

### Codex CLI

```
codex plugin marketplace add TSS-Blue-AI-Lab/tss-plugins
```

Then open `/plugins` and install `secaudit`.

### Codex desktop app

No CLI needed — the app has a UI for this:

1. Open **Plugins**, then **Create** → **Add Marketplace**, and add
   `TSS-Blue-AI-Lab/tss-plugins`.
2. Back in **Plugins**, open the **Personal** tab, find **secaudit** under
   **TSS Plugins**, and hit **Install**.

Installing from a private repository uses your existing Git credentials (credential helper,
SSH agent, or token). If a client cannot authenticate to the private remote in your
environment, clone the remote locally and install the plugin from that clone — this tests the
same committed package boundary.

## Run

A full audit is **explicit-only**: installing the plugin never authorizes either client to
start one on its own initiative, because a full run spawns many agents and costs real money.

```
Claude Code: /secaudit:run [repo-path] [--output <exact-run-directory>]
Codex:       $secaudit:run [repo-path] [--output <exact-run-directory>]
```

`repo-path` is optional and accepts an absolute or relative directory; when omitted, secaudit
audits the Git toplevel above your current directory, or the current directory if it is not in
a repository. The target does not have to be a Git repository. Before any spend, the launcher
shows you the resolved target, a size and estimated-token line, a recommended Hunter subset,
and asks which Hunters to run and whether to include the Blindspot Sweep.

When the path was omitted, the resolved target is a guess — and from a subdirectory it widens
to the whole repository — so the launcher asks you to confirm it, or name a different one,
before writing anything. Pass `repo-path` explicitly to skip that question and to audit a
subdirectory on its own.

secaudit never modifies the repository being audited: it hashes the source, audits an isolated
copy, and re-hashes before publishing. If the source changed mid-audit, publication aborts.

## Output

One run writes exactly one directory:

```
<project-root>/.secaudit/runs/<run-id>/
├── trace.md            # corpus hash, coverage, template version, stage ledger
└── work/sast/          # per-Hunter results, deduped set, and report-data.json — the
                        # structured findings the secaudit:issues dashboard reads
```

No report is rendered. `report-data.json` is the run's record of what it found, and the
`secaudit:issues` dashboard is the human view of it.

The project root is the audited tree's own Git toplevel; if the audited tree is in no
repository — a staged or copied workspace, say — it is the Git toplevel above your current
directory, so the report lands in the repository you are working in rather than in the copy;
failing both, it is the target. `--output` overrides the choice entirely. The launcher prints
the resolved location before any spend.

`<run-id>` is a UTC timestamp plus the first eight characters of the source hash. Every run
directory inside a working tree carries its own `.gitignore`, so no run — default or `--output` —
makes a clean repository look dirty. That matters beyond tidiness: the work tree is a
verbatim copy of the target including dotfiles, so an unignored run directory puts real
`.env` secrets one `git add -A` from a commit.

The copied source is removed on a successful publish, leaving `work/sast/` — the stage
evidence and `report-data.json`. A run that reports `cleanup-incomplete` still holds that copy
and names what remains; delete those entries by hand. Deleting
`<project-root>/.secaudit/runs/<run-id>/` is safe at any time — that is how you reclaim disk,
though the dashboard then loses that run's history.

Audit part of a repository with `--scope <target-relative-path>` (repeatable, or one
comma-separated value) rather than staging a copy of the subset: scope restricts what is read
while the target, project root, and corpus hash keep referring to the real repository.

`--output` overrides the exact run directory, not just its parent. Paths that would make the
isolated copy contain itself, that contain the target, or that point at a non-empty directory
secaudit does not own are rejected before anything is copied.

## The Workbench

`/secaudit:issues [project-path]` opens the triage board. It first syncs the persistent issue
store with every run it can discover in the project, then serves the board locally:

```
node "<plugin>/skills/issues/scripts/server.mjs" --project "<project>"
{"url":"http://127.0.0.1:53129"}
```

The server binds to `127.0.0.1` only, serves one project, and stops with Ctrl-C. The board
itself is a static page — no build step, no CDN, no network at runtime; IBM Plex ships with it.

Decisions live in `<project-root>/.secaudit/issues.json` and are the only thing that moves a
card between the three board columns. Findings the audit refuted — Challenge said
`NOT-A-DEFECT`, or Trace said `UNREACHABLE` — never reach the inbox at all: they open in the
archive marked as the audit's own verdict, and return to the inbox by themselves if a later run
stops refuting them. Only a human dismissal is permanent. Findings are matched across runs by a code anchor rather than by title or line number, so
the same defect stays one card as the file changes around it. A finding marked a false positive
is archived and suppressed at publication time in every later run until someone restores it; a
finding that simply stops appearing is never marked done, because scope and coverage differ
between runs. Nothing done on the board changes a historical run's report.

## Limitations

- **Concurrent runs against one target are unsupported.** Run identifiers do not collide, but
  which run publishes is undefined. Run one audit per target at a time.
- Vendored and generated code is out of scope: a fixed built-in denylist (`.git`, `.secaudit`,
  `node_modules`, `bin`, `obj`, `dist`, `build`, `vendor`, `.venv`, `venv`, `target`,
  `__pycache__`) is excluded from measurement, hashing, and copying. There are no user-facing
  include/exclude flags in v1.
- Symlinks resolving outside the target are never followed into the audit corpus; they are
  recorded as skipped so coverage stays visible.
- Dependency and vulnerability scanning of manifests and lockfiles is a separate concern and is
  not part of this pipeline.
- Resume after an interrupted run is a Claude Code workflow capability only; it is not promised
  in Codex.
- secaudit reports findings with evidence. It never certifies that a codebase is secure.

## Layout

What ships when you install the plugin:

- `skills/` — the canonical skill tree for both clients: `run` (launcher), `sast-analysis` +
  `sast-hunter-*` (detection library), `secaudit-*` (pipeline stages), and the deterministic
  runtime under `skills/run/scripts/`
- `workflows/secaudit.js` — the deterministic Claude Code workflow spine
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` — per-client plugin manifests
- `README.md` — this file
- `NOTICE` — third-party copyright notices, which must travel with every copy

Nothing else is packaged: tests, docs, and CI config live in this repository but are not part
of the plugin a user installs.

## Development

This repository (`tss-plugins`) is the development home for the plugin, not just its
marketplace host. Plugin content lives at `plugins/secaudit/` (the layout above); its tests
live at `tests/secaudit/`. Run the suite with:

```
for t in tests/*/*.test.mjs; do node "$t"; done
```

Developer-only material — local corpora, private baselines, generated runs, scratch, and
caches — lives under the ignored `.secaudit-local/` root and is never pushed or packaged.

# tss-plugins — Public Multi-Agent Plugin Marketplace

**Date:** 2026-08-03
**Status:** Approved (brainstorming session)
**Repo:** https://github.com/AI-Lab-Yonder/tss-plugins

## Goal

Set up `tss-plugins` as a public plugin marketplace hosting multiple plugins, installable
natively from Claude Code and Codex (CLI + desktop app), and consumable by other agents
(Cursor, Copilot, Gemini CLI, OpenCode, …) via the agent-agnostic skills.sh installer.
First plugin: `secaudit`, copied from the `security-scanning` dev repo.

## Roles of the two repos

- `security-scanning` — **dev** repo. All development, tests, dev tooling stay here.
- `tss-plugins` — **prod** repo. Clean, public-ready, release artifacts only.
  Clean linear git history: one conventional commit per plugin release.
- Retiring the dev repo is deferred; for now dev → prod sync is a release step.

## Repository layout

```
tss-plugins/
├── .claude-plugin/
│   └── marketplace.json          # Claude Code catalog
├── .agents/
│   └── plugins/
│       └── marketplace.json      # Codex catalog (CLI + desktop app)
├── plugins/
│   └── secaudit/
│       ├── .claude-plugin/
│       │   └── plugin.json       # name, version, description, author, keywords
│       ├── .codex-plugin/
│       │   └── plugin.json       # same + "skills": "./skills/" + interface block
│       ├── skills/               # ONE canonical skill tree — serves every agent
│       ├── workflows/            # secaudit.js — deterministic Claude Code workflow
│       └── README.md             # plugin docs (pipeline, usage, install)
├── .github/
│   └── workflows/
│       └── validate.yml          # CI validation on every push/PR
├── README.md                     # marketplace overview + per-agent install matrix
└── LICENSE                       # plain MIT, © AI Lab Yonder
```

## Manifests

### `.claude-plugin/marketplace.json` (Claude Code)

- Required: `name` (kebab-case marketplace id, e.g. `tss-plugins`), `owner.name`, `plugins[]`.
- Each plugin entry: `name`, `source: "./plugins/secaudit"` (relative path), plus
  `description`, `category`, `author`, `license`, `keywords`.
- Do NOT set `version` in both marketplace entry and plugin.json — plugin.json wins
  silently. Version lives in plugin.json only.

### `.agents/plugins/marketplace.json` (Codex)

- Fields: `name`, `interface.displayName`, `plugins[]`.
- Each plugin entry: `name`,
  `source: { "source": "local", "path": "./plugins/secaudit" }`,
  `policy: { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }`,
  `category`.
- Subdirectory paths are officially supported (`source.path`).

### Per-plugin manifests

- `.claude-plugin/plugin.json`: `name`, `version` (semver — users receive updates only on
  version bump), `description`, `author`, `keywords`. Skills auto-discovered in `skills/`.
- `.codex-plugin/plugin.json`: same metadata + explicit `"skills": "./skills/"` and an
  `interface` block (displayName, shortDescription, category) following the superpowers
  pattern.

## Install channels

| Agent | Install |
|---|---|
| Claude Code | `/plugin marketplace add AI-Lab-Yonder/tss-plugins` → `/plugin install secaudit@tss-plugins` |
| Codex CLI | `codex plugin marketplace add AI-Lab-Yonder/tss-plugins` → `/plugins` → install |
| Codex desktop app | Add marketplace via CLI (above), restart app, marketplace appears as selectable source in Plugins Directory |
| Other agents | `npx skills add AI-Lab-Yonder/tss-plugins` (skills.sh detects agent, installs SKILL.md folders) |

Notes:
- Codex also reads `$REPO_ROOT/.claude-plugin/marketplace.json` as a legacy fallback;
  native `.agents/plugins/marketplace.json` is the primary.
- Submission to official directories (`openai/plugins`, `claude-plugins-official`) is a
  deferred, optional follow-up; not required for custom marketplace installs.

## Known trade-off

Cursor/Gemini/Kimi-style extension manifests assume repo root = single plugin (why
superpowers is one-plugin-per-repo). This monorepo covers Claude + Codex natively;
everything else via skills.sh. If a specific agent later needs first-class support, that
plugin can be split or tagged then.

## Release flow (dev → prod)

Dev repo already has release tooling: `scripts/package-release.mjs` + `scripts/preflight.mjs`
build a validated package from a tracked-file allowlist (`PACKAGE_PREFIXES`:
`.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `skills/`, `workflows/`, `README.md`).
That allowlist is the authoritative copy scope. Only missing piece: extracting the package
into `tss-plugins/plugins/secaudit/` (per-agent plugin manifests come along; the dev repo's
root marketplace manifests are NOT copied — tss-plugins authors its own).

1. Develop and test in `security-scanning`.
2. Run the release packaging, extract into `tss-plugins/plugins/secaudit/`.
   Never copied: tests, caches, dev scripts, `.secaudit-local`, `.worktrees`, `.superpowers`.
3. Bump `version` in both plugin.json files (they must match).
4. One conventional commit: `feat(secaudit): v0.2.0`.
5. CI green → push. Users pick up the release via `/plugin marketplace update`.

Edit policy: plugin fixes always go to `security-scanning`, then re-release — never edit
`plugins/*` files directly in tss-plugins (the next release overwrites them wholesale).
Direct edits here are limited to root marketplace manifests, README, CI.

## CI validation (`validate.yml`)

On push/PR:
1. `claude plugin validate . --strict` — official schema validation (marketplace.json,
   plugin.json, skill frontmatter, duplicate names, path traversal).
2. JSON syntax check on `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json`
   (no official Codex validator identified; `jq` parse + required-field check).
3. Version consistency: `.claude-plugin/plugin.json` version == `.codex-plugin/plugin.json`
   version for each plugin.

## Error handling

- CI fails the PR on any invalid manifest, duplicate plugin name, or version mismatch —
  broken catalogs never reach consumers.
- `strict` mode default (plugin.json is authority; marketplace entries supplement).

## Testing

- CI checks above are the test surface for this repo. Plugin behavior tests remain in the
  dev repo — prod repo ships release artifacts, not test infrastructure.
- Manual smoke test after first release: install from a clean machine via all three
  channels (Claude Code, Codex CLI, skills.sh) and run one secaudit skill.

## Out of scope

- The dev-repo extract-into-tss-plugins step (separate task in `security-scanning`).
- Official directory submissions (openai/plugins, claude-plugins-official).
- Additional plugins beyond secaudit (layout already accommodates them).

## Decision record (interview 2026-08-03)

### Decided

1. Marketplace identity → name `tss-plugins`, owner `AI Lab Yonder` (org AI-Lab-Yonder).
   Settles: install commands fixed; rules out repo rename and personal ownership.
2. License → plain MIT, © AI Lab Yonder; `"license": "MIT"` in manifests. No NOTICE file;
   sast-skills credit stays in README.
3. Fix routing → all plugin content changes via dev repo + re-release (see Edit policy).
4. Going public → deferred, user's call; current work is local scaffolding. LICENSE/README
   built now so the flip needs no prep.
5. First prod version → `0.1.0`, matching dev; `1.0.0` reserved for declared stability.

### Still open / verify during implementation

- skills.sh: `npx skills add` walks skill containers one level deep — nested
  `plugins/secaudit/skills/` may need an explicit path in install docs. Verify by testing.
- CI: confirm `claude plugin validate` works headless in GitHub Actions (install method,
  no-API-key operation).

### Changed by interview

- Layout was missing `plugins/secaudit/workflows/` — dev ships `workflows/secaudit.js` and
  its release allowlist includes it. Fixed above.
- "Sync script to be written" was wrong — packaging/validation already exists in dev repo;
  only the extract step is missing. Release flow rewritten above.
- Dev repo has no LICENSE file despite README claiming MIT — prod adds one; dev should too.

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
│       └── README.md             # plugin docs (pipeline, usage, install)
├── .github/
│   └── workflows/
│       └── validate.yml          # CI validation on every push/PR
├── README.md                     # marketplace overview + per-agent install matrix
└── LICENSE                       # MIT (secaudit seeded from MIT sast-skills)
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

1. Develop and test in `security-scanning`.
2. Sync script (lives in dev repo, out of scope here) copies the clean subset into
   `tss-plugins/plugins/secaudit/`: `skills/`, plugin manifests, plugin README.
   Never copied: tests, caches, dev scripts, `.secaudit-local`, `.worktrees`, `.superpowers`.
3. Bump `version` in both plugin.json files (they must match).
4. One conventional commit: `feat(secaudit): v0.2.0`.
5. CI green → push. Users pick up the release via `/plugin marketplace update`.

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

- The dev-repo sync script implementation (separate task in `security-scanning`).
- Official directory submissions (openai/plugins, claude-plugins-official).
- Additional plugins beyond secaudit (layout already accommodates them).

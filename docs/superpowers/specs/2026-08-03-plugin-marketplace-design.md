# tss-plugins — Public Multi-Agent Plugin Marketplace

**Date:** 2026-08-03
**Status:** Approved (brainstorming session)
**Repo:** https://github.com/AI-Lab-Yonder/tss-plugins

## Goal

Set up `tss-plugins` as a public plugin marketplace hosting multiple plugins, installable
natively from Claude Code and Codex (CLI + desktop app) — the two supported install
channels. First plugin: `secaudit`, copied from the `security-scanning` dev repo.

## Roles of the two repos

**Revised 2026-08-04:** `tss-plugins` is the source of truth from now on — development,
tests, and releases all happen here. `security-scanning` goes dormant after the initial
import (archive whenever convenient); its packaging pipeline (`scripts/package-release.mjs`,
`preflight.mjs`, `zip.mjs`) is not ported — it existed only for dev→prod publishing, which
no longer exists. Resurrect from its git history if release zips are ever needed.

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
├── tests/
│   └── secaudit/                 # test suite for the secaudit plugin (NOT shipped —
│       ├── fixtures/             #   outside plugins/, so installs never include it)
│       ├── workflow-harness.mjs  # helpers: harness + preflight-policy.mjs
│       └── *.test.mjs            # 19 ported content tests + forbidden-references test
├── .github/
│   └── workflows/
│       └── ci.yml                # tests (OS×Node matrix) + manifest validation
├── .gitattributes                # `* text=auto eol=lf` — golden fixtures compare bytes
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

Claude Code and Codex are the only supported install channels.

Notes:
- Codex also reads `$REPO_ROOT/.claude-plugin/marketplace.json` as a legacy fallback;
  native `.agents/plugins/marketplace.json` is the primary.
- Submission to official directories (`openai/plugins`, `claude-plugins-official`) is a
  deferred, optional follow-up; not required for custom marketplace installs.

## Known trade-off

Cursor/Gemini/Kimi-style extension manifests assume repo root = single plugin (why
superpowers is one-plugin-per-repo). This monorepo covers Claude + Codex natively and
nothing else; other agents are not a supported install path. If a specific agent later needs
first-class support, that plugin can be split or tagged then.

## Release flow (revised 2026-08-04 — development happens here)

Initial import: one-time copy of the dev repo's tracked plugin files (`.claude-plugin/plugin.json`,
`.codex-plugin/`, `skills/`, `workflows/`, `README.md`) into `plugins/secaudit/`, and the
content test suite into `tests/secaudit/` (adapted paths). After that:

1. Develop directly in `plugins/secaudit/`, tests in `tests/secaudit/`.
2. To release: bump `version` in both plugin.json files (they must match), conventional
   commit (`feat(secaudit): v0.2.0`), CI green, push.
3. Users pick up the release via `/plugin marketplace update`.

## CI (`ci.yml`)

Hardening (ported from dev repo's ci.yml): `permissions: contents: read`, concurrency
group with cancel-in-progress, actions pinned by commit SHA.

Job 1 — tests, OS×Node matrix (macos/ubuntu/windows × Node 22, plus ubuntu × Node 24):
run `node tests/secaudit/*.test.mjs` (deterministic suite, no framework).

Job 2 — manifest validation (ubuntu):
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

- Plugin behavior tests live at `tests/secaudit/` (ported from dev repo): 19 content tests
  (runtime, skill vocabularies, workflow behavior via harness, manifests, reports against
  golden fixtures) + a forbidden-references test (shipped files must not mention dev-only
  paths — salvaged from preflight.mjs). Dropped, not ported: `package-preflight`,
  `package-release`, `zip-roundtrip`, `validate-repo-hygiene` (packaging machinery).
- Tests sit OUTSIDE `plugins/` so plugin installs never include them.
- Manual smoke test after first release: install from a clean machine via both supported
  channels (Claude Code, Codex CLI) and run one secaudit skill.

## Out of scope

- Official directory submissions (openai/plugins, claude-plugins-official).
- Additional plugins beyond secaudit (layout already accommodates them).
- Release zip packaging (dropped with the dev/prod split; in dev repo's git history if needed).

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

- CI: confirm `claude plugin validate` works headless in GitHub Actions (install method,
  no-API-key operation).

### Revised 2026-08-04 (supersedes decisions 3 and parts of the layout)

6. Development moves to tss-plugins → this repo is the source of truth; `security-scanning`
   dormant after import. Kills decision 3's fix-routing and the dev→prod sync flow.
7. Tests port here (content tests only, 19 files + fixtures + harness) into `tests/secaudit/`;
   packaging tests and `scripts/` are NOT ported. One salvage: forbidden-references test.
8. CI expands to dev repo's pattern: OS×Node matrix running the suite + hardening (pinned
   SHAs, read-only permissions, concurrency) + the manifest-validation job. `.gitattributes`
   (`* text=auto eol=lf`) ports verbatim — golden-fixture byte comparisons require it.
9. The third install channel for other agents (Cursor, Copilot, Gemini CLI, …) via the
   agent-agnostic installer referenced earlier in this spec is dropped: it was documented but
   never implemented or verified. Claude Code and Codex are the only supported channels.

### Changed by interview

- Layout was missing `plugins/secaudit/workflows/` — dev ships `workflows/secaudit.js` and
  its release allowlist includes it. Fixed above.
- "Sync script to be written" was wrong — packaging/validation already exists in dev repo;
  only the extract step is missing. Release flow rewritten above.
- Dev repo has no LICENSE file despite README claiming MIT — prod adds one; dev should too.

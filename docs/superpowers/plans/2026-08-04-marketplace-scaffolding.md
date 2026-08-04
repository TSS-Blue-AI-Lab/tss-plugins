# tss-plugins Marketplace Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `tss-plugins` as a public multi-agent plugin marketplace with `secaudit` v0.1.0 as its first plugin, installable from Claude Code and Codex, validated by CI.

**Architecture:** Monorepo marketplace: root catalogs for Claude Code (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json`) point at `plugins/secaudit/`, whose content is imported verbatim (tracked files only) from the `security-scanning` dev repo. One GitHub Actions workflow validates all manifests on every push/PR.

**Tech Stack:** JSON manifests, GitHub Actions, `claude` CLI (`plugin validate`), `jq`, `git archive` for the import.

**Spec:** `docs/superpowers/specs/2026-08-03-plugin-marketplace-design.md`

## Global Constraints

- Marketplace name: `tss-plugins`; owner: `AI Lab Yonder` (GitHub org `AI-Lab-Yonder`).
- Plugin version: `0.1.0`, identical in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
- Never set `version` in marketplace plugin entries — plugin.json is the version authority.
- License: plain MIT, © AI Lab Yonder, `"license": "MIT"` in manifests.
- `plugins/secaudit/` content comes only from the dev repo (tracked files); never hand-edit it after import. The dev repo's ROOT marketplace manifests (`.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`) are NOT copied.
- All names kebab-case.
- Conventional commit messages (`feat:`, `docs:`, `ci:`, `chore:`).
- Dev repo path on this machine: `../security-scanning`.

---

### Task 1: Root files — LICENSE, .gitignore, README

**Files:**
- Create: `LICENSE`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: install commands and edit-policy wording later tasks and users rely on; LICENSE referenced by `license` fields in Task 3/4 manifests.

- [ ] **Step 1: Write LICENSE**

```
MIT License

Copyright (c) 2026 AI Lab Yonder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write .gitignore**

```
.DS_Store
node_modules/
*.log
```

- [ ] **Step 3: Write README.md**

```markdown
# tss-plugins

Public plugin marketplace by AI Lab Yonder. One canonical skill tree per plugin serves
Claude Code, Codex (CLI + desktop app), and any agent that reads standard `SKILL.md`
folders.

## Plugins

| Plugin | Version | Description |
|---|---|---|
| [secaudit](plugins/secaudit/) | 0.1.0 | Agentic source-code security audit: Recon → Hunt → Challenge → Dedupe → Trace → report generation. Deterministic Node runtime, never mutates the target repo. |

## Install

### Claude Code

```
/plugin marketplace add AI-Lab-Yonder/tss-plugins
/plugin install secaudit@tss-plugins
```

### Codex CLI

```
codex plugin marketplace add AI-Lab-Yonder/tss-plugins
```

Then open `/plugins` and install `secaudit`.

### Codex desktop app

Add the marketplace via the Codex CLI command above, restart the app, then pick
`tss-plugins` as the source in the Plugins Directory and install from there.

### Other agents (Cursor, Copilot, Gemini CLI, OpenCode, …)

Via [skills.sh](https://skills.sh), pointing at the plugin's skill tree:

```
npx skills add AI-Lab-Yonder/tss-plugins --path plugins/secaudit/skills
```

## Contributing

Plugin content under `plugins/` is release-synced from each plugin's development
repository — do not edit those files here; the next release overwrites them wholesale.
Direct changes in this repo are limited to the root marketplace manifests, this README,
and CI.

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 4: Verify files exist and README renders**

Run: `ls LICENSE .gitignore README.md && head -3 README.md`
Expected: three files listed; first heading `# tss-plugins`.

- [ ] **Step 5: Commit**

```bash
git add LICENSE .gitignore README.md
git commit -m "chore: add license, gitignore, marketplace readme"
```

---

### Task 2: Import secaudit plugin from dev repo

**Files:**
- Create: `plugins/secaudit/.claude-plugin/plugin.json`
- Create: `plugins/secaudit/.codex-plugin/plugin.json`
- Create: `plugins/secaudit/skills/` (22 skill dirs, includes `skills/run/scripts/secaudit-runtime.mjs`)
- Create: `plugins/secaudit/workflows/secaudit.js`
- Create: `plugins/secaudit/README.md`

**Interfaces:**
- Consumes: tracked files of `../security-scanning` at `HEAD`.
- Produces: `plugins/secaudit/` tree that Task 3/4 marketplace manifests reference by path `./plugins/secaudit`; plugin name `secaudit`, version `0.1.0` read by Task 5 CI checks.

- [ ] **Step 1: Import tracked files only (git archive — no untracked junk)**

```bash
DEV=../security-scanning
mkdir -p plugins/secaudit
git -C "$DEV" archive HEAD \
  .claude-plugin/plugin.json .codex-plugin skills workflows README.md \
  | tar -x -C plugins/secaudit
```

- [ ] **Step 2: Verify inventory — exactly the allowlist, no dev-repo marketplace manifests**

Run:
```bash
ls -A plugins/secaudit
test ! -e plugins/secaudit/.agents && test ! -e plugins/secaudit/.claude-plugin/marketplace.json && echo CLEAN
ls plugins/secaudit/skills | wc -l
jq -r '.name + " " + .version' plugins/secaudit/.claude-plugin/plugin.json plugins/secaudit/.codex-plugin/plugin.json
```
Expected: entries `.claude-plugin .codex-plugin skills workflows README.md`; `CLEAN`; `22`; two lines both `secaudit 0.1.0`.

If the dev repo's tracked `.claude-plugin/` contains `marketplace.json` in the archive output, delete it: `rm plugins/secaudit/.claude-plugin/marketplace.json` — only `plugin.json` ships.

- [ ] **Step 3: Commit**

```bash
git add plugins/secaudit
git commit -m "feat(secaudit): import v0.1.0 from security-scanning"
```

---

### Task 3: Claude Code marketplace manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: `plugins/secaudit/` from Task 2 (`source` path must resolve).
- Produces: marketplace id `tss-plugins` used in install commands and by Task 5 CI validation.

- [ ] **Step 1: Write manifest**

```json
{
  "name": "tss-plugins",
  "owner": {
    "name": "AI Lab Yonder",
    "url": "https://github.com/AI-Lab-Yonder"
  },
  "description": "AI Lab Yonder public plugin marketplace.",
  "plugins": [
    {
      "name": "secaudit",
      "source": "./plugins/secaudit",
      "description": "Agentic source-code security audit: Recon, one Hunter per vulnerability class, adversarial Challenge, Dedupe, reachability Trace, and deterministic report publication. Never mutates the target repository.",
      "category": "Security",
      "license": "MIT",
      "keywords": ["security", "sast", "code-audit", "vulnerability", "static-analysis"]
    }
  ]
}
```

Note: no `version` field in the plugin entry — `plugin.json` is the authority (Global Constraints).

- [ ] **Step 2: Validate with the official validator**

Run: `claude plugin validate . --strict`
Expected: exit 0, no errors. (Warnings about unrecognized fields would fail `--strict` — remove any offending field and re-run.)

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat: add claude code marketplace catalog"
```

---

### Task 4: Codex marketplace manifest

**Files:**
- Create: `.agents/plugins/marketplace.json`

**Interfaces:**
- Consumes: `plugins/secaudit/` from Task 2 (`source.path` must resolve).
- Produces: Codex catalog consumed by `codex plugin marketplace add` and by Task 5 CI jq check (fields `name`, `plugins[].name`, `plugins[].source.path`, `plugins[].policy`).

- [ ] **Step 1: Write manifest**

```json
{
  "name": "tss-plugins",
  "interface": {
    "displayName": "TSS Plugins"
  },
  "plugins": [
    {
      "name": "secaudit",
      "source": {
        "source": "local",
        "path": "./plugins/secaudit"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Security"
    }
  ]
}
```

- [ ] **Step 2: Validate JSON shape**

Run:
```bash
jq -e '.name == "tss-plugins" and (.plugins | length) == 1 and all(.plugins[]; .name and .source.path and .policy.installation)' .agents/plugins/marketplace.json
```
Expected: prints `true`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .agents/plugins/marketplace.json
git commit -m "feat: add codex marketplace catalog"
```

---

### Task 5: CI validation workflow

**Files:**
- Create: `.github/workflows/validate.yml`

**Interfaces:**
- Consumes: both marketplace manifests (Tasks 3–4), `plugins/*/.claude-plugin/plugin.json` and `plugins/*/.codex-plugin/plugin.json` (Task 2).
- Produces: the release gate — every push/PR must pass before it reaches consumers.

- [ ] **Step 1: Run each future CI check locally first (they must pass before wiring CI)**

```bash
claude plugin validate . --strict
jq -e '.name and (.plugins | length) > 0 and all(.plugins[]; .name and .source.path and .policy)' .agents/plugins/marketplace.json
for p in plugins/*/; do
  c=$(jq -r .version "$p.claude-plugin/plugin.json")
  x=$(jq -r .version "$p.codex-plugin/plugin.json")
  [ "$c" = "$x" ] && echo "OK $p $c" || { echo "MISMATCH $p $c vs $x"; exit 1; }
done
```
Expected: validator exit 0; `true`; `OK plugins/secaudit/ 0.1.0`.

- [ ] **Step 2: Write workflow**

```yaml
name: validate

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Validate marketplace and plugins (Claude)
        run: claude plugin validate . --strict

      - name: Validate Codex marketplace manifest
        run: |
          jq -e '.name and (.plugins | length) > 0 and all(.plugins[]; .name and .source.path and .policy)' .agents/plugins/marketplace.json

      - name: Check per-plugin version consistency
        run: |
          for p in plugins/*/; do
            c=$(jq -r .version "$p.claude-plugin/plugin.json")
            x=$(jq -r .version "$p.codex-plugin/plugin.json")
            if [ "$c" != "$x" ]; then
              echo "version mismatch in $p: claude=$c codex=$x"
              exit 1
            fi
          done
```

Known risk (spec "verify during implementation"): `claude plugin validate` headless on a
runner. It runs without an API key locally; if the CI step fails for environment reasons
(not manifest errors), keep the step but report the failure to the user — do not delete
validation to get CI green.

- [ ] **Step 3: Validate workflow YAML syntax**

Run: `node -e "console.log('yaml ok')" && npx --yes yaml-lint .github/workflows/validate.yml || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/validate.yml')); print('yaml ok')"`
Expected: `yaml ok` (either linter suffices).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/validate.yml
git commit -m "ci: validate marketplace manifests and version consistency"
```

---

### Task 6: End-to-end local smoke test

**Files:**
- None created — verification only. (If a fix is needed, it happens in the task that owns the file, then re-run this task.)

**Interfaces:**
- Consumes: the whole repo state from Tasks 1–5.

- [ ] **Step 1: Full-tree validation from a clean checkout state**

```bash
git status --porcelain   # expect empty
claude plugin validate . --strict
```
Expected: clean tree; validator exit 0.

- [ ] **Step 2: Install marketplace + plugin locally in Claude Code**

Run:
```bash
claude plugin marketplace add "$(pwd)"
claude plugin install secaudit@tss-plugins
claude plugin list
```
Expected: marketplace `tss-plugins` added; `secaudit` listed as installed, version `0.1.0`.

- [ ] **Step 3: Verify one skill resolves**

Start `claude` in any directory and check that secaudit skills (e.g. `secaudit:secaudit`) appear in the skills listing, or run: `ls "$(claude plugin list 2>/dev/null | grep -o '/[^ ]*secaudit[^ ]*' | head -1)"` — simpler: confirm install output reported skills loaded. Manual check acceptable; record the result.

- [ ] **Step 4: Cleanup local test install**

```bash
claude plugin uninstall secaudit@tss-plugins
claude plugin marketplace remove tss-plugins
```
Expected: both commands succeed; local state back to pre-test.

- [ ] **Step 5: Codex check (only if `codex` CLI installed — skip otherwise, record skipped)**

```bash
codex plugin marketplace add "$(pwd)" && codex plugin marketplace list
```
Expected: `tss-plugins` listed. Then remove: `codex plugin marketplace remove tss-plugins` (or per CLI help).

- [ ] **Step 6: Report results**

No commit — report smoke-test outcomes (including any skipped/failed steps verbatim) to the user. Repo going public + pushing remain the user's manual actions per spec.

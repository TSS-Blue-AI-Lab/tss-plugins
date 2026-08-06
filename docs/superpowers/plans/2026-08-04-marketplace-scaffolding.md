# tss-plugins Marketplace Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `tss-plugins` as a public multi-agent plugin marketplace with `secaudit` v0.1.0 as its first plugin — including its test suite, since development happens in this repo from now on — installable from Claude Code and Codex, validated by CI.

**Architecture:** Monorepo marketplace and development home: root catalogs for Claude Code (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json`) point at `plugins/secaudit/`, imported once (tracked files only) from the now-dormant `security-scanning` repo. Content tests port to `tests/secaudit/` (outside `plugins/` — installs never include them). CI runs the suite on an OS×Node matrix plus a manifest-validation job.

**Tech Stack:** JSON manifests, Node ≥22 zero-framework `.test.mjs` suite, GitHub Actions, `claude` CLI (`plugin validate`), `jq`, `git archive` for the import.

**Spec:** `docs/superpowers/specs/2026-08-03-plugin-marketplace-design.md`

## Global Constraints

- Marketplace name: `tss-plugins`; owner: `TSS Blue AI Lab` (GitHub org `AI-Lab-Yonder`).
- Plugin version: `0.1.0`, identical in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
- Never set `version` in marketplace plugin entries — plugin.json is the version authority.
- License: plain MIT, © TSS Blue AI Lab, `"license": "MIT"` in manifests.
- Initial import copies dev-repo tracked files only; the dev repo's ROOT marketplace manifests (`.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`) and `scripts/` are NOT copied. After import, this repo is the source of truth — development happens here.
- Tests live at `tests/secaudit/`, never inside `plugins/` (plugin installs copy the whole plugin dir).
- Not ported (packaging machinery, obsolete): `scripts/`, `tests/package-preflight.test.mjs`, `tests/package-release.test.mjs`, `tests/zip-roundtrip.test.mjs`, `tests/validate-repo-hygiene.test.mjs`.
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

Copyright (c) 2026 TSS Blue AI Lab

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

Public plugin marketplace by TSS Blue AI Lab. One canonical skill tree per plugin serves
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

This repository is the development home for its plugins. Plugin content lives under
`plugins/<name>/`, its tests under `tests/<name>/`. Run the suite with:

```
for t in tests/*/*.test.mjs; do node "$t"; done
```

Releases: bump `version` in the plugin's `.claude-plugin/plugin.json` AND
`.codex-plugin/plugin.json` (must match), commit conventionally (`feat(secaudit): v0.2.0`).

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 4: Copy .gitattributes from dev repo (verbatim — LF pinning; golden-fixture byte comparisons and Windows CI depend on it)**

```bash
cp ../security-scanning/.gitattributes .gitattributes
```

Verify: `tail -1 .gitattributes` → `* text=auto eol=lf`

- [ ] **Step 5: Verify files exist and README renders**

Run: `ls LICENSE .gitignore .gitattributes README.md && head -3 README.md`
Expected: four files listed; first heading `# tss-plugins`.

- [ ] **Step 6: Commit**

```bash
git add LICENSE .gitignore .gitattributes README.md
git commit -m "chore: add license, gitignore, gitattributes, marketplace readme"
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
    "name": "TSS Blue AI Lab",
    "url": "https://github.com/AI-Lab-Yonder"
  },
  "description": "TSS Blue AI Lab public plugin marketplace.",
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

### Task 5: Port the secaudit test suite

**Files:**
- Create: `tests/secaudit/*.test.mjs` (19 ported files), `tests/secaudit/workflow-harness.mjs`, `tests/secaudit/fixtures/*`
- Create: `tests/secaudit/preflight-policy.mjs` (helper extracted from dev `scripts/preflight.mjs`)
- Create: `tests/secaudit/forbidden-references.test.mjs` (new)

**Interfaces:**
- Consumes: `plugins/secaudit/` tree from Task 2 (tests resolve the plugin root as `../../plugins/secaudit` relative to each test file).
- Produces: the suite Task 6's CI matrix runs (`for t in tests/*/*.test.mjs; do node "$t"; done`).

- [ ] **Step 1: Copy tests from dev repo (tracked files), drop the 4 packaging tests**

```bash
DEV=../security-scanning
mkdir -p tests/secaudit
git -C "$DEV" archive HEAD tests | tar -x --strip-components=1 -C tests/secaudit
rm tests/secaudit/package-preflight.test.mjs \
   tests/secaudit/package-release.test.mjs \
   tests/secaudit/zip-roundtrip.test.mjs \
   tests/secaudit/validate-repo-hygiene.test.mjs
ls tests/secaudit/*.test.mjs | wc -l   # expect 19
```

- [ ] **Step 2: Create the policy helper (replaces imports of `../scripts/preflight.mjs`)**

Write `tests/secaudit/preflight-policy.mjs` — functions copied verbatim from dev `scripts/preflight.mjs`:

```javascript
// Extracted from security-scanning scripts/preflight.mjs — the one predicate the content
// tests share. Codex honours allow_implicit_invocation only as a direct child of the
// top-level `policy:` key; no YAML parser here (zero dependencies), slice by indentation.
const yamlBlock = (text, key) => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^${key}:\\s*$`).test(line))
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n')
}
const indentOf = line => /^[ \t]*/.exec(line)[0].length

export const hasExplicitOnlyPolicy = text => {
  const block = yamlBlock(text, 'policy')
  if (block === null) return false
  const lines = block.split('\n').filter(l => l.trim() !== '' && !/^[ \t]*#/.test(l))
  if (lines.length === 0) return false
  const childIndent = Math.min(...lines.map(indentOf))
  return lines.some(l =>
    indentOf(l) === childIndent && /^[ \t]*allow_implicit_invocation:[ \t]*false[ \t]*$/.test(l))
}
```

- [ ] **Step 3: Adapt paths (repo root moved: tests now live two levels up from the plugin)**

```bash
cd tests/secaudit
sed -i '' \
  -e "s|fileURLToPath(import.meta.url)), '..')|fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')|g" \
  -e "s|'\.\./skills/|'../../plugins/secaudit/skills/|g" \
  -e "s|'\.\./workflows/|'../../plugins/secaudit/workflows/|g" \
  -e "s|'\.\./scripts/preflight.mjs'|'./preflight-policy.mjs'|g" \
  *.mjs
cd ../..
```

Then hunt stragglers — any remaining reference that still points at the old layout:

```bash
grep -rn "\.\./skills\|\.\./scripts\|\.\./workflows\|'\.\./\.claude" tests/secaudit/*.mjs || echo NO-STRAGGLERS
```
Expected: `NO-STRAGGLERS`. Fix any hit by hand using the same mapping (plugin content → `../../plugins/secaudit/...`).

- [ ] **Step 4: Run the suite; adapt `validate-manifests.test.mjs` expectations if needed**

```bash
set -e; for t in tests/secaudit/*.test.mjs; do echo "--- $t"; node "$t"; done
```

Expected: all pass. Known likely failure: `validate-manifests.test.mjs` asserted the DEV repo's manifest set (its root marketplace files, which were deliberately not copied). If it fails looking for a root `marketplace.json` inside the plugin dir, update its expectations to this repo's layout: plugin manifests at `plugins/secaudit/.claude-plugin/plugin.json` + `plugins/secaudit/.codex-plugin/plugin.json`, root catalogs at `.claude-plugin/marketplace.json` + `.agents/plugins/marketplace.json`. Keep every assertion that still has a subject; delete only assertions about files that no longer exist by design.

- [ ] **Step 5: Write the forbidden-references test (salvaged idea from dev preflight)**

`tests/secaudit/forbidden-references.test.mjs`:

```javascript
// Shipped plugin files must never reference dev-only paths: a consumer's install contains
// only plugins/secaudit/**, so any such reference is a broken pointer by construction.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const FORBIDDEN = ['.claude/skills', '.agents/skills', '.claude/commands', '.claude/workflows', '.secaudit-local/', '<private-client-identifier>']

const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const offenders = []
for (const file of walk(pluginRoot)) {
  if (!/\.(md|mjs|js|json|yaml|yml)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const ref of FORBIDDEN) {
    if (text.includes(ref)) offenders.push(`${file}: ${ref}`)
  }
}
assert.deepStrictEqual(offenders, [], `forbidden references in shipped files:\n${offenders.join('\n')}`)
console.log('forbidden-references: ok')
```

- [ ] **Step 6: Run the new test**

Run: `node tests/secaudit/forbidden-references.test.mjs`
Expected: `forbidden-references: ok` (if it fails, the listed file/reference pairs are real defects imported from dev — report them, do not weaken the list).

- [ ] **Step 7: Commit**

```bash
git add tests
git commit -m "test(secaudit): port content test suite from security-scanning"
```

---

### Task 6: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: test suite (Task 5), both marketplace manifests (Tasks 3–4), per-plugin plugin.json pairs (Task 2).
- Produces: the merge/release gate — every push/PR must pass.

- [ ] **Step 1: Run each future CI check locally first (they must pass before wiring CI)**

```bash
set -e; for t in tests/*/*.test.mjs; do node "$t"; done
claude plugin validate . --strict
jq -e '.name and (.plugins | length) > 0 and all(.plugins[]; .name and .source.path and .policy)' .agents/plugins/marketplace.json
for p in plugins/*/; do
  c=$(jq -r .version "$p.claude-plugin/plugin.json")
  x=$(jq -r .version "$p.codex-plugin/plugin.json")
  [ "$c" = "$x" ] && echo "OK $p $c" || { echo "MISMATCH $p $c vs $x"; exit 1; }
done
```
Expected: suite passes; validator exit 0; `true`; `OK plugins/secaudit/ 0.1.0`.

- [ ] **Step 2: Write workflow (hardening ported from dev ci.yml: read-only permissions, concurrency, SHA-pinned actions)**

```yaml
name: ci

on:
  push:
    branches: ['**']
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: tests (${{ matrix.os }}, node ${{ matrix.node }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            node: 22
          - os: ubuntu-latest
            node: 22
          - os: windows-latest
            node: 22
          - os: ubuntu-latest
            node: 24
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: ${{ matrix.node }}
      # Windows runners provide Bash, so one loop covers all three platforms.
      - name: Run the deterministic suite
        shell: bash
        run: |
          set -euo pipefail
          for t in tests/*/*.test.mjs; do
            echo "--- $t"
            node "$t"
          done

  manifests:
    name: manifest validation
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
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

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')" || npx --yes yaml-lint .github/workflows/ci.yml`
Expected: `yaml ok` (either linter suffices).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test matrix and marketplace manifest validation"
```

---

### Task 7: End-to-end local smoke test

**Files:**
- None created — verification only. (If a fix is needed, it happens in the task that owns the file, then re-run this task.)

**Interfaces:**
- Consumes: the whole repo state from Tasks 1–6.

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

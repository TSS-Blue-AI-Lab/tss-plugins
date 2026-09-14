# secaudit Issue Store and Cross-Run Identity Implementation Plan (Part 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a pile of per-run reports into one persistent issue board: import every run (current and legacy layouts), match observations across runs by a code anchor rather than by title or line number, and keep human decisions — confirm, done, false positive — durable across audits and restarts.

**Architecture:** Four leaf modules under `plugins/secaudit/skills/issues/scripts/`, each independently testable: `run-catalog.mjs` (where runs live), `run-import.mjs` (reading a run's structured evidence), `fingerprint.mjs` (cross-run identity), and `issue-store.mjs` (state, transitions, atomic persistence). Anchors are computed at publish time, while the source copy still exists, and travel inside `report-data.json`; everything downstream is a pure function of stored data.

**Tech Stack:** Node.js 22+, ESM (`.mjs`), zero runtime dependencies. Tests run as `node tests/secaudit/<name>.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-10-secaudit-workbench-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-10-secaudit-run-lifecycle.md` (Part 1) — marker v2, the persisted run context, and publication state.

## Global Constraints

- Node.js 22 or newer; no new runtime dependencies.
- Never modify a historical run's report files or marker. Import reads; it does not write into runs.
- Import must be idempotent: re-importing a run, or restarting a partial import, changes nothing.
- Never infer a human decision from an audit verdict. `challengeVerdict: DEFECT` is not human confirmation.
- Suppression is absolute: once a human marks an issue a false positive, no later audit observation may resurface it, on the board or in the actionable report. Only an explicit human restore lifts it. The guarantee is a deterministic fingerprint match, never a prompt.
- Absence from a later run never resolves an issue: scope and coverage differ between runs.
- Store writes are atomic (`.tmp` + `rename`) and version-checked; a stale write is rejected, never merged blindly.
- Paths inside the store are POSIX-relative to the project root.
- The audited repository's content is untrusted data. Titles, paths, and evidence are stored as text and never executed or interpolated into a shell.

---

### Task 1: Run catalog — where runs live

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/run-catalog.mjs`
- Test: `tests/secaudit/issues-run-catalog.test.mjs`

**Interfaces:**
- Produces:
  - `CATALOG_NAME = 'catalog.json'`, `CATALOG_VERSION = 1`
  - `catalogPath(projectRoot)` → `string` (`<projectRoot>/.secaudit/catalog.json`)
  - `readCatalog(projectRoot)` → `Promise<{catalogVersion: 1, runs: Array<{runId, runDir}>}>` — returns an empty catalog when the file is absent or unparseable.
  - `registerRun(projectRoot, {runId, runDir})` → `Promise<catalog>` — idempotent by `runId`; atomic write.
  - `discoverRuns(projectRoot)` → `Promise<Array<{runId, runDir, source: 'catalog'|'default'}>>` — union of catalog entries and `<projectRoot>/.secaudit/runs/*` that carry a readable marker, deduplicated by resolved `runDir`, sorted by `runId`.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-run-catalog.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { readCatalog, registerRun, discoverRuns } = await import(join(scripts, 'run-catalog.mjs'))

const project = mkdtempSync(join(tmpdir(), 'secaudit catalog-'))

function makeRunDir(base, runId) {
  const dir = join(base, runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'secaudit-run.json'), JSON.stringify({
    marker: 'secaudit-run', formatVersion: 2, runId, target: project, state: 'complete',
  }), 'utf8')
  return dir
}

// An empty project has an empty catalog, not an error.
assert.deepEqual((await readCatalog(project)).runs, [])

// Default runs are discovered without ever being registered.
makeRunDir(join(project, '.secaudit', 'runs'), '20260101T000000Z-aaaaaaaa')
const discovered = await discoverRuns(project)
assert.equal(discovered.length, 1)
assert.equal(discovered[0].source, 'default')

// An explicitly placed external run is only findable once registered.
const external = makeRunDir(mkdtempSync(join(tmpdir(), 'secaudit outside-')), '20260102T000000Z-bbbbbbbb')
await registerRun(project, { runId: '20260102T000000Z-bbbbbbbb', runDir: external })
await registerRun(project, { runId: '20260102T000000Z-bbbbbbbb', runDir: external }) // idempotent
assert.equal((await readCatalog(project)).runs.length, 1)

const both = await discoverRuns(project)
assert.deepEqual(both.map(r => r.runId),
  ['20260101T000000Z-aaaaaaaa', '20260102T000000Z-bbbbbbbb'])

// A corrupt catalog degrades to empty rather than blocking discovery of default runs.
writeFileSync(join(project, '.secaudit', 'catalog.json'), '{not json', 'utf8')
assert.equal((await discoverRuns(project)).length, 1)

console.log('issues-run-catalog: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-run-catalog.test.mjs`
Expected: FAIL — cannot find module `run-catalog.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/run-catalog.mjs
// Where this project's runs live. Default runs are rediscoverable from the filesystem; an
// explicitly placed --output run is not, so prepare registers it here. The catalog is a
// convenience index, never the source of truth: a corrupt one must not hide the default runs.
import { readdir, readFile, writeFile, rename, mkdir, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { readMarker } from '../../run/scripts/run-paths.mjs'

export const CATALOG_NAME = 'catalog.json'
export const CATALOG_VERSION = 1

export function catalogPath(projectRoot) {
  return join(projectRoot, '.secaudit', CATALOG_NAME)
}

const EMPTY = () => ({ catalogVersion: CATALOG_VERSION, runs: [] })

export async function readCatalog(projectRoot) {
  const raw = await readFile(catalogPath(projectRoot), 'utf8').catch(() => null)
  if (raw == null) return EMPTY()
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.catalogVersion !== CATALOG_VERSION || !Array.isArray(parsed.runs)) return EMPTY()
    return parsed
  } catch {
    return EMPTY()
  }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}

export async function registerRun(projectRoot, { runId, runDir }) {
  const catalog = await readCatalog(projectRoot)
  if (catalog.runs.some(r => r.runId === runId)) return catalog
  const next = {
    catalogVersion: CATALOG_VERSION,
    runs: [...catalog.runs, { runId, runDir }].sort((a, b) => (a.runId < b.runId ? -1 : 1)),
  }
  await atomicWriteJson(catalogPath(projectRoot), next)
  return next
}

async function canonical(path) {
  return realpath(path).catch(() => null)
}

export async function discoverRuns(projectRoot) {
  const found = new Map() // canonical runDir -> entry
  const defaultRoot = join(projectRoot, '.secaudit', 'runs')
  for (const entry of await readdir(defaultRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const dir = join(defaultRoot, entry.name)
    const marker = await readMarker(dir)
    if (!marker) continue
    const key = (await canonical(dir)) ?? dir
    found.set(key, { runId: marker.runId ?? entry.name, runDir: dir, source: 'default' })
  }
  for (const { runId, runDir } of (await readCatalog(projectRoot)).runs) {
    const key = (await canonical(runDir)) ?? runDir
    if (found.has(key)) continue
    if (!(await readMarker(runDir))) continue
    found.set(key, { runId, runDir, source: 'catalog' })
  }
  return [...found.values()].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-run-catalog.test.mjs`
Expected: PASS — `issues-run-catalog: ok`

- [ ] **Step 5: Register explicit outputs from `prepare`, then commit**

In `plugins/secaudit/skills/run/scripts/secaudit-runtime.mjs`, capture `isDefault` from
`selectRunDir` (`const { runDir, insideTarget, isDefault: isDefaultRunDir } = await selectRunDir(...)`)
and, after the `prepared` marker is written in `prepare()`:

```js
  // A default run lives under <projectRoot>/.secaudit/runs and is rediscoverable by walking the
  // filesystem. An explicitly placed one is not — if it is not indexed now, the dashboard will
  // never learn it existed.
  if (!isDefaultRunDir) {
    const { registerRun } = await import('../../issues/scripts/run-catalog.mjs')
    await registerRun(artifactRoot, { runId, runDir })
  }
```

```bash
git add plugins/secaudit/skills/issues/scripts/run-catalog.mjs \
        plugins/secaudit/skills/run/scripts/secaudit-runtime.mjs \
        tests/secaudit/issues-run-catalog.test.mjs
git commit -m "feat(secaudit): run catalog so explicit output directories stay discoverable

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The anchor algorithm

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/fingerprint.mjs`
- Test: `tests/secaudit/issues-fingerprint.test.mjs`

**Interfaces:**
- Produces:
  - `FINGERPRINT_VERSION = 1`
  - `normalizeCodeLine(text)` → `string` — collapse runs of whitespace to one space and trim; string literals are preserved verbatim.
  - `enclosingDeclaration(lines, lineNumber, ext)` → `{kind, name} | null` — nearest declaration at or above `lineNumber` (1-indexed).
  - `computeAnchor({sourceText, line, path})` → `{anchorKind: 'decl'|'file', anchorName: string, codeHash: string}`.
  - `fingerprintFor({class, path, anchorKind, anchorName, codeHash})` → `string` (`fp1:<24 hex>`).
  - `legacyFingerprintFor({class, path, line})` → `string` (`legacy1:<24 hex>`).

**The algorithm, stated exactly.** A fingerprint answers "is this the same defect?" from three
parts, none of which is the finding's title and none of which is an absolute line number:

1. **Vulnerability class** — verbatim from the report (`sqli`, `idor`, …).
2. **Normalized project-relative path** — forward slashes, no leading `./`.
3. **Code anchor** — the nearest enclosing declaration name, plus a hash of the normalized text
   of the offending line itself.

The declaration name survives edits elsewhere in the file (line shifts); the line hash keeps two
independent defects inside one function distinct. A retitled finding matches. A finding that
moved 40 lines because an import block grew matches. Two different injection sites in one
function do not collapse.

**Supported languages** (by extension, case-insensitive):

| Extensions | Declarations recognized |
|---|---|
| `.py` | `def` / `class` (optionally `async`) |
| `.js`, `.ts` | `function` declarations, `class`, and `const`/`let`/`var` bound to a function or arrow |
| `.java`, `.kt`, `.cs` | method signatures (modifiers + return type + name + `(`), and `class`/`interface`/`record`/`object`/`enum` |
| `.go` | `func`, including methods with a receiver |
| `.html`, `.cshtml` | none — falls back to `anchorKind: 'file'` |

**Legacy fallback.** When no source text is available — a historical run whose work tree was
pruned long ago — no anchor can be computed. Those observations get `legacyFingerprintFor(...)`,
which *includes* the line number and therefore does not survive line shifts. This is a
deliberate, visible limitation: a legacy fingerprint is never auto-merged with an anchored one.
When a legacy observation could belong to an existing issue, matching reports the ambiguity for
an explicit human merge instead of guessing (Task 5).

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-fingerprint.test.mjs
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { computeAnchor, fingerprintFor, legacyFingerprintFor, normalizeCodeLine } =
  await import(join(scripts, 'fingerprint.mjs'))

const before = [
  'import os',
  '',
  'def get_order(order_id):',
  '    return db.query("SELECT * FROM orders WHERE id = " + order_id)',
  '',
  'def list_orders(user):',
  '    return db.query("SELECT * FROM orders WHERE user = " + user)',
].join('\n')

// The same defect after unrelated edits above it and a reformat of the offending line.
const after = [
  'import os',
  'import sys',
  'import json',
  '',
  '',
  'def get_order(order_id):',
  '    return db.query("SELECT * FROM orders WHERE id = "  +  order_id)',
  '',
  'def list_orders(user):',
  '    return db.query("SELECT * FROM orders WHERE user = " + user)',
].join('\n')

const fp = f => fingerprintFor({ class: 'sqli', path: 'app/orders.py', ...f })

const a = computeAnchor({ sourceText: before, line: 4, path: 'app/orders.py' })
const b = computeAnchor({ sourceText: after, line: 7, path: 'app/orders.py' })
assert.equal(a.anchorKind, 'decl')
assert.equal(a.anchorName, 'get_order')
assert.equal(fp(a), fp(b), 'a line shift plus whitespace reformat must not change identity')

// Two independent defects of the same class in one file stay distinct.
const other = computeAnchor({ sourceText: after, line: 10, path: 'app/orders.py' })
assert.notEqual(fp(a), fp(other))

// Files with no declaration grammar anchor to the file plus the line's text.
const html = computeAnchor({
  sourceText: '<div>{{ user_input }}</div>\n', line: 1, path: 'templates/x.html',
})
assert.equal(html.anchorKind, 'file')
assert.equal(html.anchorName, 'templates/x.html')

// Normalization collapses whitespace but preserves literals.
assert.equal(normalizeCodeLine('   a  =  "b  c"  '), 'a = "b  c"')

// Legacy fingerprints are a distinct namespace and can never collide with anchored ones.
const legacy = legacyFingerprintFor({ class: 'sqli', path: 'app/orders.py', line: 4 })
assert.ok(legacy.startsWith('legacy1:'))
assert.ok(fp(a).startsWith('fp1:'))
assert.notEqual(legacy, fp(a))

// Go, JS, and C# declarations resolve.
assert.equal(computeAnchor({
  sourceText: 'package main\n\nfunc (s *Server) Handle(w http.ResponseWriter) {\n\texec(cmd)\n}\n',
  line: 4, path: 'srv/main.go',
}).anchorName, 'Handle')
assert.equal(computeAnchor({
  sourceText: 'export async function login(req) {\n  db.raw(req.body.q)\n}\n',
  line: 2, path: 'src/login.js',
}).anchorName, 'login')
assert.equal(computeAnchor({
  sourceText: 'public class Orders {\n  public Order Get(int id) {\n    return Sql(id);\n  }\n}\n',
  line: 3, path: 'src/Orders.cs',
}).anchorName, 'Get')

console.log('issues-fingerprint: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-fingerprint.test.mjs`
Expected: FAIL — cannot find module `fingerprint.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/fingerprint.mjs
// Cross-run identity. Deliberately excludes the finding's TITLE (a model rewords it every run)
// and its ABSOLUTE LINE (an import block above it shifts it). What remains is the class, the
// normalized path, the nearest enclosing declaration, and a hash of the offending line's text —
// stable under edits elsewhere, distinct for two defects inside one function.
import { createHash } from 'node:crypto'
import { extname } from 'node:path'

export const FINGERPRINT_VERSION = 1

const JS_PATTERNS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/,
]
const CLASSLIKE = /^\s*(?:public|private|protected|internal|abstract|sealed|static|final|open|data|\s)*(?:class|interface|record|object|enum)\s+([A-Za-z_]\w*)/
const METHODLIKE = /^\s*(?:@\w+\s*)*(?:public|private|protected|internal|static|final|override|suspend|abstract|virtual|async|fun|\s)*[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\(/

const DECL_PATTERNS = new Map([
  ['.py', [/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/]],
  ['.js', JS_PATTERNS],
  ['.ts', JS_PATTERNS],
  ['.go', [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/]],
  ['.java', [METHODLIKE, CLASSLIKE]],
  ['.kt', [METHODLIKE, CLASSLIKE]],
  ['.cs', [METHODLIKE, CLASSLIKE]],
])

export function normalizeCodeLine(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

export function enclosingDeclaration(lines, lineNumber, ext) {
  const patterns = DECL_PATTERNS.get(ext)
  if (!patterns) return null
  for (let i = Math.min(lineNumber, lines.length) - 1; i >= 0; i--) {
    for (const pattern of patterns) {
      const match = pattern.exec(lines[i])
      const name = match?.slice(1).find(Boolean)
      if (name) return { kind: 'decl', name }
    }
  }
  return null
}

export function computeAnchor({ sourceText, line, path }) {
  const lines = String(sourceText).split(/\r?\n/)
  const ext = extname(path).toLowerCase()
  const decl = enclosingDeclaration(lines, line, ext)
  const raw = lines[Math.min(Math.max(line, 1), lines.length) - 1] ?? ''
  return {
    anchorKind: decl ? 'decl' : 'file',
    anchorName: decl ? decl.name : path,
    codeHash: createHash('sha256').update(normalizeCodeLine(raw), 'utf8').digest('hex').slice(0, 16),
  }
}

function digest(parts) {
  return createHash('sha256').update(parts.join(' '), 'utf8').digest('hex').slice(0, 24)
}

export function fingerprintFor({ class: cls, path, anchorKind, anchorName, codeHash }) {
  return 'fp1:' + digest(['v1', cls, path, anchorKind, anchorName, codeHash])
}

// No source text was available (a pruned historical run), so there is no anchor and the line
// number has to stand in for one. A legacy fingerprint therefore does NOT survive line shifts,
// and matching never auto-merges one with an anchored fingerprint — it asks a human instead.
export function legacyFingerprintFor({ class: cls, path, line }) {
  return 'legacy1:' + digest(['legacy1', cls, path, String(line)])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-fingerprint.test.mjs`
Expected: PASS — `issues-fingerprint: ok`

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/fingerprint.mjs tests/secaudit/issues-fingerprint.test.mjs
git commit -m "feat(secaudit): code-anchor fingerprints for cross-run finding identity

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Persist anchors at publish time, while the source copy still exists

**Files:**
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/report-data.schema.json`
- Test: `tests/secaudit/artifact-publisher.test.mjs` (append)

**Interfaces:**
- Consumes: `computeAnchor`, `fingerprintFor` (Task 2); `validateReportData` (existing).
- Produces: each finding in the published `report-data.json` gains
  `anchor: {version: 1, anchorKind, anchorName, codeHash, fingerprint} | null`.
  `validateReportData` accepts findings with or without it (historical data has none) but
  rejects a malformed one. New export `annotateAnchors(reportData, work)` → `Promise<reportData>`.

Anchors must be written *before* `pruneWorkExceptSast` deletes the copy: after cleanup there is
no source to anchor against, and the target itself may already have moved on.

- [ ] **Step 1: Write the failing test**

Append to `tests/secaudit/artifact-publisher.test.mjs`, reusing whichever helper that file
already defines for building a valid run directory (referred to here as `makeRun()`, returning
`{target, runDir, work, ledgerPath, corpus}`):

```js
// --- anchors are persisted before the source copy is pruned ----------------
{
  const fixture = await makeRun()   // its work tree still holds the copied source
  await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  const published = JSON.parse(
    readFileSync(join(fixture.work, 'sast', 'report-data.json'), 'utf8'))
  for (const finding of published.findings) {
    assert.equal(finding.anchor.version, 1)
    assert.ok(finding.anchor.fingerprint.startsWith('fp1:'))
    assert.equal(finding.anchor.codeHash.length, 16)
  }
  // The source copy is gone, but the anchors survived it.
  assert.deepEqual(readdirSync(fixture.work), ['sast'])

  console.log('artifact-publisher anchors: ok')
}
```

Add `readdirSync` to the file's `node:fs` import list if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/artifact-publisher.test.mjs`
Expected: FAIL — `finding.anchor` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `report-contract.mjs`, validate the optional anchor inside `validateFinding`:

```js
  if (finding.anchor !== undefined && finding.anchor !== null) {
    const a = finding.anchor
    requireValue(a && typeof a === 'object', 'finding.anchor must be an object when present')
    requireValue(a.version === 1, 'finding.anchor.version must be 1')
    requireValue(['decl', 'file'].includes(a.anchorKind), 'finding.anchor.anchorKind is invalid: ' + a.anchorKind)
    requireValue(nonEmpty(a.anchorName), 'finding.anchor.anchorName is required')
    requireValue(/^[0-9a-f]{16}$/.test(a.codeHash), 'finding.anchor.codeHash must be 16 lowercase hex characters')
    requireValue(/^fp1:[0-9a-f]{24}$/.test(a.fingerprint), 'finding.anchor.fingerprint must be fp1:<24 hex>')
  }
```

Mirror it in `report-data.schema.json`, inside the finding `properties` object:

```json
        "anchor": {
          "type": ["object", "null"],
          "required": ["version", "anchorKind", "anchorName", "codeHash", "fingerprint"],
          "additionalProperties": false,
          "properties": {
            "version": { "const": 1 },
            "anchorKind": { "enum": ["decl", "file"] },
            "anchorName": { "type": "string", "minLength": 1 },
            "codeHash": { "type": "string", "pattern": "^[0-9a-f]{16}$" },
            "fingerprint": { "type": "string", "pattern": "^fp1:[0-9a-f]{24}$" }
          }
        }
```

In `publish-artifacts.mjs`, import the fingerprint module and add the annotator:

```js
import { computeAnchor, fingerprintFor } from '../../issues/scripts/fingerprint.mjs'
```

```js
// Anchors are computed HERE, and only here, because this is the last moment the copied source
// exists: the next statement prunes it, and the target itself may change the minute we finish.
// A finding whose file is missing from the copy (scoped out, or a path the model invented) is
// left without an anchor rather than anchored to a guess — import treats it as legacy identity.
export async function annotateAnchors(reportData, work) {
  const findings = []
  for (const finding of reportData.findings) {
    const sourceText = await readFile(join(work, ...finding.path.split('/')), 'utf8')
      .catch(() => null)
    if (sourceText == null) {
      findings.push({ ...finding, anchor: null })
      continue
    }
    const anchor = computeAnchor({ sourceText, line: finding.line, path: finding.path })
    findings.push({
      ...finding,
      anchor: {
        version: 1,
        ...anchor,
        fingerprint: fingerprintFor({ class: finding.class, path: finding.path, ...anchor }),
      },
    })
  }
  return { ...reportData, findings }
}
```

Then, between the three artifact writes and the prune (Part 1 Task 5 put the marker updates
here; the anchor write goes immediately before them):

```js
  const anchored = await annotateAnchors(reportData, work)
  validateReportData(anchored)
  await atomicWrite(reportDataPath, JSON.stringify(anchored, null, 2) + '\n')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/artifact-publisher.test.mjs && node tests/secaudit/report-contract.test.mjs && node tests/secaudit/generate-artifacts-integration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs \
        plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs \
        plugins/secaudit/skills/secaudit-generate-artifacts/report-data.schema.json \
        tests/secaudit/artifact-publisher.test.mjs
git commit -m "feat(secaudit): persist code anchors before the source copy is pruned

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Run import — both layouts, idempotent

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/run-import.mjs`
- Test: `tests/secaudit/issues-run-import.test.mjs`

**Interfaces:**
- Consumes: `readMarker` (run-paths), `validateReportData` (report-contract), `legacyFingerprintFor` (fingerprint).
- Produces:
  - `findReportData(runDir)` → `Promise<string | null>` — `<runDir>/sast/report-data.json`, else `<runDir>/work/sast/report-data.json`, else `null`.
  - `importRun(runDir)` → `Promise<ImportedRun>` where `ImportedRun` is either
    `{runId, runDir, createdUtc, target, scope, status: 'ok', observations}` or
    `{runId, runDir, status: 'unavailable', reason}`.
  - `Observation = {observationId, runId, class, path, line, title, severity, challengeVerdict, challengeReason, traceVerdict, traceEvidence, impact, remediation, dynamicTest, fingerprint, fingerprintKind: 'anchor'|'legacy'}`

An unreadable or malformed run becomes one `unavailable` entry with a reason. It must never
throw and abort the import of every other run.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-run-import.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const scripts = join(here, '..', '..', 'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { findReportData, importRun } = await import(join(scripts, 'run-import.mjs'))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'report-data.json'), 'utf8'))

function makeRun({ layout, runId, findings = fixture.findings }) {
  const dir = mkdtempSync(join(tmpdir(), 'secaudit import-'))
  const sast = layout === 'legacy' ? join(dir, 'sast') : join(dir, 'work', 'sast')
  mkdirSync(sast, { recursive: true })
  writeFileSync(join(sast, 'report-data.json'), JSON.stringify({ ...fixture, findings }), 'utf8')
  writeFileSync(join(dir, 'secaudit-run.json'), JSON.stringify({
    marker: 'secaudit-run', formatVersion: 2, runId, target: '/p', state: 'complete',
    createdUtc: '2026-01-01T00:00:00.000Z', scope: [],
  }), 'utf8')
  return dir
}

// Both layouts are found.
assert.ok((await findReportData(makeRun({ layout: 'legacy', runId: 'r-legacy' })))
  .endsWith(join('sast', 'report-data.json')))
assert.ok((await findReportData(makeRun({ layout: 'current', runId: 'r-current' })))
  .includes('work'))

// Findings without anchors import under legacy identity, and say so.
const legacy = await importRun(makeRun({ layout: 'legacy', runId: 'r1' }))
assert.equal(legacy.status, 'ok')
assert.equal(legacy.observations.length, fixture.findings.length)
assert.equal(legacy.observations[0].fingerprintKind, 'legacy')
assert.ok(legacy.observations[0].fingerprint.startsWith('legacy1:'))
assert.equal(legacy.observations[0].observationId, fixture.findings[0].id)

// Findings with anchors import under anchor identity.
const anchored = await importRun(makeRun({
  layout: 'current',
  runId: 'r2',
  findings: fixture.findings.map(f => ({
    ...f,
    anchor: { version: 1, anchorKind: 'decl', anchorName: 'handler',
      codeHash: 'a'.repeat(16), fingerprint: 'fp1:' + 'b'.repeat(24) },
  })),
}))
assert.equal(anchored.observations[0].fingerprintKind, 'anchor')
assert.equal(anchored.observations[0].fingerprint, 'fp1:' + 'b'.repeat(24))

// Import is pure: calling it twice yields deeply equal results.
const runDir = makeRun({ layout: 'current', runId: 'r3' })
assert.deepEqual(await importRun(runDir), await importRun(runDir))

// A malformed run is reported, not thrown.
const broken = makeRun({ layout: 'current', runId: 'r4' })
writeFileSync(join(broken, 'work', 'sast', 'report-data.json'), '{oops', 'utf8')
const bad = await importRun(broken)
assert.equal(bad.status, 'unavailable')
assert.match(bad.reason, /report-data\.json/)

// A run with no report at all is unavailable, not empty-but-ok: "no findings" and "never
// finished" must not look the same on the board.
const empty = mkdtempSync(join(tmpdir(), 'secaudit import-empty-'))
writeFileSync(join(empty, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 2, runId: 'r5', target: '/p', state: 'prepared',
}), 'utf8')
assert.equal((await importRun(empty)).status, 'unavailable')

console.log('issues-run-import: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-run-import.test.mjs`
Expected: FAIL — cannot find module `run-import.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/run-import.mjs
// Reads a run's structured evidence. READ ONLY: the reports are the audit record, and importing
// them must never edit them. Two layouts exist in the wild — <run>/sast (older runs, published
// after their work tree was flattened) and <run>/work/sast (current) — and both stay supported.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readMarker } from '../../run/scripts/run-paths.mjs'
import { validateReportData } from '../../secaudit-generate-artifacts/scripts/report-contract.mjs'
import { legacyFingerprintFor } from './fingerprint.mjs'

async function isFile(path) {
  const st = await stat(path).catch(() => null)
  return Boolean(st?.isFile())
}

export async function findReportData(runDir) {
  for (const candidate of [
    join(runDir, 'sast', 'report-data.json'),
    join(runDir, 'work', 'sast', 'report-data.json'),
  ]) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

function toObservation(finding, runId) {
  const anchored = finding.anchor?.fingerprint
  return {
    observationId: finding.id,
    runId,
    class: finding.class,
    path: finding.path,
    line: finding.line,
    title: finding.title,
    severity: finding.severity ?? null,
    challengeVerdict: finding.challengeVerdict,
    challengeReason: finding.challengeReason,
    traceVerdict: finding.traceVerdict ?? null,
    traceEvidence: finding.traceEvidence ?? null,
    impact: finding.impact ?? null,
    remediation: finding.remediation ?? null,
    dynamicTest: finding.dynamicTest ?? null,
    fingerprint: anchored ?? legacyFingerprintFor(finding),
    fingerprintKind: anchored ? 'anchor' : 'legacy',
  }
}

export async function importRun(runDir) {
  const marker = await readMarker(runDir)
  const runId = marker?.runId ?? null
  const unavailable = reason => ({ runId, runDir, status: 'unavailable', reason })
  if (!marker) return unavailable('not a secaudit run directory (missing or invalid marker)')

  const reportPath = await findReportData(runDir)
  // "No report" is not "no findings". A run that never published must read as unfinished on the
  // board, or an interrupted audit looks like a clean bill of health.
  if (!reportPath) return unavailable('no report-data.json under ' + runDir + ' (sast/ or work/sast/)')

  let reportData
  try {
    reportData = validateReportData(JSON.parse(await readFile(reportPath, 'utf8')))
  } catch (err) {
    return unavailable('unreadable report-data.json: ' + err.message)
  }

  return {
    runId,
    runDir,
    createdUtc: marker.createdUtc ?? null,
    target: marker.target ?? null,
    scope: marker.scope ?? [],
    status: 'ok',
    observations: reportData.findings.map(f => toObservation(f, runId)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-run-import.test.mjs`
Expected: PASS — `issues-run-import: ok`

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/run-import.mjs tests/secaudit/issues-run-import.test.mjs
git commit -m "feat(secaudit): import run evidence from both run layouts, read-only

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Issue store — matching, human state, suppression

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/issue-store.mjs`
- Test: `tests/secaudit/issues-store.test.mjs`

**Interfaces:**
- Consumes: observations from `importRun` (Task 4).
- Produces:
  - `STORE_VERSION = 1`, `storePath(projectRoot)` → `<projectRoot>/.secaudit/issues.json`, `emptyStore()`
  - `Store = {storeVersion, revision, issues: Issue[], importedRuns: Array<{runId, createdUtc, importedUtc, observationCount}>}`
  - `Issue = {id, class, path, line, title, severity, humanState: 'inbox'|'confirmed'|'done'|'suppressed', ambiguous: boolean, fingerprints: string[], observations: Array<{runId, observationId, fingerprint}>, firstSeenRunId, lastSeenRunId, lastHumanUtc, events: Event[]}`
  - `Event = {utc, actor: 'system'|'human', type, from?, to?, runId?}`
  - `ingestRun(store, importedRun)` → `{store, outcomes}` — **pure**; `outcomes` is `Array<{observationId, issueId, outcome: 'new'|'repeat'|'reopened'|'suppressed'|'ambiguous'}>`
  - `applyTransition(store, {issueId, action, revision, utc})` → `{store}` — **pure**; `action` is one of `confirm | false-positive | done | reopen | restore`; throws with `.code = 'E_CONFLICT'` on a stale revision, `'E_TRANSITION'` on an illegal move, `'E_NOT_FOUND'` on an unknown issue.
  - `readStore(projectRoot)` → `Promise<Store>`; `writeStore(projectRoot, store)` → `Promise<Store>` — atomic, bumps `revision`.

**Transition table** (human actions only; the audit never moves a card):

| From \ Action | confirm | false-positive | done | reopen | restore |
|---|---|---|---|---|---|
| `inbox` | → `confirmed` | → `suppressed` | refused | refused | refused |
| `confirmed` | refused | → `suppressed` | → `done` | → `inbox` | refused |
| `done` | → `confirmed` | → `suppressed` | refused | → `inbox` | refused |
| `suppressed` | refused | refused | refused | refused | → `inbox` |

Inbox→done is refused: nothing reaches Done without a human having confirmed it first. That is
the one move the mockup's `canMove` also blocks.

A **human** `reopen` returns an issue to the inbox — they are re-triaging it. The **audit**
reopening a done issue is a different event and lands it in `confirmed`, keeping the human
confirmation that was already made. Same word, two actors, two destinations, on purpose.

**Ingestion rules:**
- Idempotency key is `runId + ' ' + observationId`. An already-ingested observation is skipped entirely — no event, no state change.
- Matching order: (1) exact fingerprint in `issue.fingerprints`; (2) otherwise a new issue. A *legacy* fingerprint never equals an *anchor* fingerprint, so when a non-matching observation's `(class, path)` resembles exactly one existing issue, it is attached with `outcome: 'ambiguous'` and the issue is flagged `ambiguous: true` for an explicit human merge. When it resembles more than one, a new issue is created, also flagged.
- `suppressed` issues absorb the observation, record a `suppressed-match` event, and never change state.
- `done` issues reopen to `confirmed` **only** when the observation's run started after the issue's last human transition (`lastHumanUtc`). That is what stops a late import of an *older* run from reopening something a human already resolved.
- `inbox` and `confirmed` issues record a `repeat` event and keep their state.
- Nothing in `ingestRun` closes an issue. Absence is never an outcome.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-store.test.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { emptyStore, ingestRun, applyTransition, readStore, writeStore } =
  await import(join(scripts, 'issue-store.mjs'))

const obs = (over = {}) => ({
  observationId: 'sqli@a.py:4@deadbeefcafe',
  runId: 'r1', class: 'sqli', path: 'a.py', line: 4, title: 'SQL injection',
  severity: 'High', challengeVerdict: 'DEFECT', challengeReason: 'concatenated',
  traceVerdict: 'REACHABLE', traceEvidence: 'route to handler', impact: 'i', remediation: 'r',
  dynamicTest: null, fingerprint: 'fp1:' + '1'.repeat(24), fingerprintKind: 'anchor', ...over,
})
const run = (runId, createdUtc, observations) => ({
  runId, runDir: '/x/' + runId, createdUtc, target: '/p', scope: [], status: 'ok', observations,
})

// A first observation creates an inbox issue.
let store = emptyStore()
let out = ingestRun(store, run('r1', '2026-01-01T00:00:00Z', [obs()]))
store = out.store
assert.equal(store.issues.length, 1)
assert.equal(store.issues[0].humanState, 'inbox')
assert.equal(out.outcomes[0].outcome, 'new')

// Re-ingesting the same run changes nothing at all.
const before = JSON.stringify(store)
store = ingestRun(store, run('r1', '2026-01-01T00:00:00Z', [obs()])).store
assert.equal(JSON.stringify(store), before, 're-import must be a no-op')

// A later run with the same fingerprint attaches as a repeat, not a second card.
out = ingestRun(store, run('r2', '2026-02-01T00:00:00Z',
  [obs({ runId: 'r2', observationId: 'sqli@a.py:9@other', title: 'Rewritten title' })]))
store = out.store
assert.equal(store.issues.length, 1)
assert.equal(out.outcomes[0].outcome, 'repeat')
assert.equal(store.issues[0].observations.length, 2)

// Human path: confirm then done. Inbox to done is refused.
const id = store.issues[0].id
assert.throws(() => applyTransition(store, { issueId: id, action: 'done',
  revision: store.revision, utc: '2026-02-02T00:00:00Z' }), err => err.code === 'E_TRANSITION')
store = applyTransition(store, { issueId: id, action: 'confirm', revision: store.revision,
  utc: '2026-02-02T00:00:00Z' }).store
assert.equal(store.issues[0].humanState, 'confirmed')
store = applyTransition(store, { issueId: id, action: 'done', revision: store.revision,
  utc: '2026-02-03T00:00:00Z' }).store
assert.equal(store.issues[0].humanState, 'done')

// A later actionable observation reopens it into Confirmed, keeping its history.
out = ingestRun(store, run('r3', '2026-03-01T00:00:00Z',
  [obs({ runId: 'r3', observationId: 'sqli@a.py:11@x' })]))
store = out.store
assert.equal(store.issues[0].humanState, 'confirmed')
assert.equal(out.outcomes[0].outcome, 'reopened')
assert.ok(store.issues[0].events.some(e => e.type === 'confirm'), 'earlier confirmation retained')

// A LATE import of an OLDER run must not reopen it again after it is done.
store = applyTransition(store, { issueId: id, action: 'done', revision: store.revision,
  utc: '2026-03-05T00:00:00Z' }).store
out = ingestRun(store, run('r0', '2025-12-01T00:00:00Z',
  [obs({ runId: 'r0', observationId: 'sqli@a.py:2@old' })]))
store = out.store
assert.equal(store.issues[0].humanState, 'done', 'an out-of-order old run must not reopen')

// Suppression is absolute.
store = applyTransition(store, { issueId: id, action: 'reopen', revision: store.revision,
  utc: '2026-04-01T00:00:00Z' }).store
assert.equal(store.issues[0].humanState, 'inbox', 'a human reopen re-triages, back to the inbox')
store = applyTransition(store, { issueId: id, action: 'false-positive', revision: store.revision,
  utc: '2026-04-02T00:00:00Z' }).store
assert.equal(store.issues[0].humanState, 'suppressed')
out = ingestRun(store, run('r4', '2026-05-01T00:00:00Z',
  [obs({ runId: 'r4', observationId: 'sqli@a.py:12@y' })]))
store = out.store
assert.equal(store.issues[0].humanState, 'suppressed', 'a later audit must never unsuppress')
assert.equal(out.outcomes[0].outcome, 'suppressed')
assert.equal(store.issues[0].observations.length, 5, 'evidence is retained while suppressed')

// Only an explicit human restore lifts it, back to the inbox.
store = applyTransition(store, { issueId: id, action: 'restore', revision: store.revision,
  utc: '2026-06-01T00:00:00Z' }).store
assert.equal(store.issues[0].humanState, 'inbox')

// Stale writes are rejected, not merged.
assert.throws(() => applyTransition(store, { issueId: id, action: 'confirm',
  revision: store.revision - 1, utc: '2026-06-02T00:00:00Z' }), err => err.code === 'E_CONFLICT')

// Two independent defects in one file remain two issues.
store = ingestRun(store, run('r5', '2026-07-01T00:00:00Z', [
  obs({ runId: 'r5', observationId: 'a', fingerprint: 'fp1:' + '2'.repeat(24) }),
  obs({ runId: 'r5', observationId: 'b', fingerprint: 'fp1:' + '3'.repeat(24) }),
])).store
assert.equal(store.issues.length, 3)

// A legacy observation that resembles an anchored issue is flagged, never silently merged.
out = ingestRun(store, run('r6', '2026-08-01T00:00:00Z', [obs({
  runId: 'r6', observationId: 'legacy-one', fingerprintKind: 'legacy',
  fingerprint: 'legacy1:' + 'f'.repeat(24),
})]))
store = out.store
assert.equal(out.outcomes[0].outcome, 'ambiguous')
assert.ok(store.issues.find(i => i.id === out.outcomes[0].issueId).ambiguous)

// Round-trips through disk.
const project = mkdtempSync(join(tmpdir(), 'secaudit store-'))
const written = await writeStore(project, store)
assert.equal(written.revision, store.revision + 1, 'writeStore bumps the revision')
const reloaded = await readStore(project)
assert.equal(reloaded.issues.length, store.issues.length)
assert.equal(reloaded.revision, written.revision)

console.log('issues-store: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-store.test.mjs`
Expected: FAIL — cannot find module `issue-store.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/issue-store.mjs
// Persistent issue identity and human decisions. Two rules dominate the design:
//   1. The audit never moves a card. Only a human transition changes humanState.
//   2. Absence proves nothing. Scope and coverage differ between runs, so a finding that stops
//      appearing is not fixed — nothing here closes an issue on its own.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'

export const STORE_VERSION = 1

export function storePath(projectRoot) {
  return join(projectRoot, '.secaudit', 'issues.json')
}

export function emptyStore() {
  return { storeVersion: STORE_VERSION, revision: 0, issues: [], importedRuns: [] }
}

// From the mockup (output/secaudit-workbench.html:318,323). Note the asymmetry, and that it is
// deliberate: a HUMAN who reopens a done issue is re-triaging it, so it goes back to the inbox.
// The AUDIT reopening a done issue (attach(), below) lands it in confirmed instead, because a
// human already confirmed that finding once and that decision is not discarded.
const TRANSITIONS = {
  inbox: { confirm: 'confirmed', 'false-positive': 'suppressed' },
  confirmed: { reopen: 'inbox', done: 'done', 'false-positive': 'suppressed' },
  done: { reopen: 'inbox', confirm: 'confirmed', 'false-positive': 'suppressed' },
  suppressed: { restore: 'inbox' },
}

function issueIdFor(observation) {
  return 'iss_' + createHash('sha256')
    .update([observation.class, observation.path, observation.fingerprint].join(' '), 'utf8')
    .digest('hex').slice(0, 16)
}

const seenKey = (runId, observationId) => runId + ' ' + observationId

// A legacy fingerprint carries a line number and no anchor, so it cannot be compared with an
// anchored one. Rather than guess, an observation that merely RESEMBLES an existing issue is
// attached and flagged for an explicit human merge decision.
function findMatch(issues, observation) {
  const exact = issues.find(i => i.fingerprints.includes(observation.fingerprint))
  if (exact) return { issue: exact, ambiguous: false }
  const resembling = issues.filter(i => i.class === observation.class && i.path === observation.path)
  if (resembling.length === 1) return { issue: resembling[0], ambiguous: true }
  return { issue: null, ambiguous: resembling.length > 1 }
}

const withEvent = (issue, event) => ({ ...issue, events: [...issue.events, event] })

function attach(issue, observation, runCreatedUtc) {
  const next = {
    ...issue,
    title: observation.title,
    line: observation.line,
    severity: observation.severity ?? issue.severity,
    fingerprints: issue.fingerprints.includes(observation.fingerprint)
      ? issue.fingerprints
      : [...issue.fingerprints, observation.fingerprint],
    observations: [...issue.observations, {
      runId: observation.runId,
      observationId: observation.observationId,
      fingerprint: observation.fingerprint,
    }],
    lastSeenRunId: observation.runId,
  }
  if (issue.humanState === 'suppressed') {
    return {
      issue: withEvent(next, { utc: runCreatedUtc, actor: 'system', type: 'suppressed-match', runId: observation.runId }),
      outcome: 'suppressed',
    }
  }
  // Only a run that STARTED after the human's decision can reopen it: importing an old run late
  // is new information about the past, not evidence the defect came back.
  const isNewer = !next.lastHumanUtc || (runCreatedUtc != null && runCreatedUtc > next.lastHumanUtc)
  if (issue.humanState === 'done' && isNewer) {
    return {
      issue: withEvent({ ...next, humanState: 'confirmed' }, {
        utc: runCreatedUtc, actor: 'system', type: 'reopened',
        from: 'done', to: 'confirmed', runId: observation.runId,
      }),
      outcome: 'reopened',
    }
  }
  return {
    issue: withEvent(next, { utc: runCreatedUtc, actor: 'system', type: 'repeat', runId: observation.runId }),
    outcome: 'repeat',
  }
}

function createIssue(observation, runCreatedUtc, ambiguous) {
  return {
    id: issueIdFor(observation),
    class: observation.class,
    path: observation.path,
    line: observation.line,
    title: observation.title,
    severity: observation.severity ?? null,
    humanState: 'inbox',
    ambiguous,
    fingerprints: [observation.fingerprint],
    observations: [{
      runId: observation.runId,
      observationId: observation.observationId,
      fingerprint: observation.fingerprint,
    }],
    firstSeenRunId: observation.runId,
    lastSeenRunId: observation.runId,
    lastHumanUtc: null,
    events: [{ utc: runCreatedUtc, actor: 'system', type: 'observed', runId: observation.runId }],
  }
}

export function ingestRun(store, importedRun) {
  if (importedRun.status !== 'ok') return { store, outcomes: [] }
  const seen = new Set()
  for (const issue of store.issues) {
    for (const o of issue.observations) seen.add(seenKey(o.runId, o.observationId))
  }
  let issues = store.issues
  const outcomes = []
  for (const observation of importedRun.observations) {
    const key = seenKey(observation.runId, observation.observationId)
    if (seen.has(key)) continue
    seen.add(key)
    const { issue: match, ambiguous } = findMatch(issues, observation)
    if (!match) {
      const created = createIssue(observation, importedRun.createdUtc, ambiguous)
      issues = [...issues, created]
      outcomes.push({
        observationId: observation.observationId,
        issueId: created.id,
        outcome: ambiguous ? 'ambiguous' : 'new',
      })
      continue
    }
    const { issue: updated, outcome } = attach(match, observation, importedRun.createdUtc)
    const flagged = ambiguous ? { ...updated, ambiguous: true } : updated
    issues = issues.map(i => (i.id === match.id ? flagged : i))
    outcomes.push({
      observationId: observation.observationId,
      issueId: match.id,
      outcome: ambiguous ? 'ambiguous' : outcome,
    })
  }
  const alreadyRecorded = store.importedRuns.some(r => r.runId === importedRun.runId)
  if (outcomes.length === 0 && alreadyRecorded) return { store, outcomes }
  const importedRuns = alreadyRecorded ? store.importedRuns : [...store.importedRuns, {
    runId: importedRun.runId,
    createdUtc: importedRun.createdUtc,
    importedUtc: importedRun.createdUtc,
    observationCount: importedRun.observations.length,
  }]
  return { store: { ...store, issues, importedRuns }, outcomes }
}

export function applyTransition(store, { issueId, action, revision, utc }) {
  if (revision !== store.revision) {
    const err = new Error('the issue store changed since this view was loaded (expected revision '
      + store.revision + ', got ' + revision + '); refresh and retry')
    err.code = 'E_CONFLICT'
    throw err
  }
  const issue = store.issues.find(i => i.id === issueId)
  if (!issue) {
    const err = new Error('no such issue: ' + issueId)
    err.code = 'E_NOT_FOUND'
    throw err
  }
  const to = TRANSITIONS[issue.humanState]?.[action]
  if (!to) {
    const err = new Error('illegal transition: ' + issue.humanState + ' + ' + action)
    err.code = 'E_TRANSITION'
    throw err
  }
  const updated = withEvent({ ...issue, humanState: to, lastHumanUtc: utc },
    { utc, actor: 'human', type: action, from: issue.humanState, to })
  return { store: { ...store, issues: store.issues.map(i => (i.id === issueId ? updated : i)) } }
}

export async function readStore(projectRoot) {
  const raw = await readFile(storePath(projectRoot), 'utf8').catch(() => null)
  if (raw == null) return emptyStore()
  const parsed = JSON.parse(raw)
  if (parsed?.storeVersion !== STORE_VERSION) {
    throw new Error('unsupported issue store version: ' + parsed?.storeVersion)
  }
  return parsed
}

// Atomic and revision-bumping. A caller that read revision N and writes back N is the only
// writer that wins; anyone else gets E_CONFLICT from applyTransition and refreshes.
export async function writeStore(projectRoot, store) {
  const path = storePath(projectRoot)
  await mkdir(dirname(path), { recursive: true })
  const next = { ...store, revision: store.revision + 1 }
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-store.test.mjs`
Expected: PASS — `issues-store: ok`

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/issue-store.mjs tests/secaudit/issues-store.test.mjs
git commit -m "feat(secaudit): persistent issue store with human transitions and absolute suppression

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Sync entry point and a post-run summary that distinguishes repeats

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/sync.mjs`
- Modify: `plugins/secaudit/skills/run/SKILL.md`
- Test: `tests/secaudit/issues-sync.test.mjs`

**Interfaces:**
- Consumes: `discoverRuns`, `importRun`, `readStore`, `ingestRun`, `writeStore`.
- Produces:
  - `syncProject(projectRoot)` → `Promise<{store, summary, unavailable}>`; `summary` is `{new, repeat, reopened, suppressed, ambiguous}` counted over this sync's outcomes; `unavailable` is `Array<{runId, runDir, reason}>`.
  - CLI: `node sync.mjs --project <path>` prints one JSON line `{summary, unavailable, issueCount}`.

Runs are ingested in ascending `createdUtc` order (falling back to `runId`), so a first-time
import replays history in the order it happened and the out-of-order guard in Task 5 only has to
defend against genuinely late imports.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-sync.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const scripts = join(here, '..', '..', 'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { syncProject } = await import(join(scripts, 'sync.mjs'))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'report-data.json'), 'utf8'))

const project = mkdtempSync(join(tmpdir(), 'secaudit sync-'))

function addRun(runId, createdUtc, findings) {
  const dir = join(project, '.secaudit', 'runs', runId)
  mkdirSync(join(dir, 'work', 'sast'), { recursive: true })
  writeFileSync(join(dir, 'work', 'sast', 'report-data.json'),
    JSON.stringify({ ...fixture, findings }), 'utf8')
  writeFileSync(join(dir, 'secaudit-run.json'), JSON.stringify({
    marker: 'secaudit-run', formatVersion: 2, runId, target: project, state: 'complete',
    createdUtc, scope: [],
  }), 'utf8')
}

const anchor = digit => ({
  version: 1, anchorKind: 'decl', anchorName: 'h' + digit,
  codeHash: String(digit).repeat(16), fingerprint: 'fp1:' + String(digit).repeat(24),
})

addRun('20260101T000000Z-aaaaaaaa', '2026-01-01T00:00:00Z',
  [{ ...fixture.findings[0], anchor: anchor(1) }])
addRun('20260201T000000Z-bbbbbbbb', '2026-02-01T00:00:00Z',
  [{ ...fixture.findings[0], anchor: anchor(1) }, { ...fixture.findings[1], anchor: anchor(2) }])

const first = await syncProject(project)
assert.equal(first.summary.new, 2)
assert.equal(first.summary.repeat, 1)
assert.equal(first.store.issues.length, 2)

// Syncing again reports nothing new: the board must not present old findings as fresh.
const second = await syncProject(project)
assert.deepEqual(second.summary, { new: 0, repeat: 0, reopened: 0, suppressed: 0, ambiguous: 0 })
assert.equal(second.store.issues.length, 2)

// A broken run is listed as unavailable and does not stop the others.
const broken = join(project, '.secaudit', 'runs', '20260301T000000Z-cccccccc')
mkdirSync(join(broken, 'work', 'sast'), { recursive: true })
writeFileSync(join(broken, 'work', 'sast', 'report-data.json'), '{bad', 'utf8')
writeFileSync(join(broken, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 2, runId: '20260301T000000Z-cccccccc',
  target: project, state: 'complete', createdUtc: '2026-03-01T00:00:00Z',
}), 'utf8')

const third = await syncProject(project)
assert.equal(third.unavailable.length, 1)
assert.equal(third.store.issues.length, 2)

console.log('issues-sync: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-sync.test.mjs`
Expected: FAIL — cannot find module `sync.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/sync.mjs
// Bring the issue store up to date with every discoverable run. Ingestion is ordered oldest
// first so a first-time import replays history as it happened. A repeat is reported as a
// repeat: presenting a finding the operator triaged three runs ago as "new" is how a board
// loses its credibility.
import { pathToFileURL } from 'node:url'
import { discoverRuns } from './run-catalog.mjs'
import { importRun } from './run-import.mjs'
import { readStore, writeStore, ingestRun } from './issue-store.mjs'

const EMPTY_SUMMARY = () => ({ new: 0, repeat: 0, reopened: 0, suppressed: 0, ambiguous: 0 })

export async function syncProject(projectRoot) {
  const imported = []
  const unavailable = []
  for (const { runDir } of await discoverRuns(projectRoot)) {
    const result = await importRun(runDir)
    if (result.status === 'ok') imported.push(result)
    else unavailable.push({ runId: result.runId, runDir: result.runDir, reason: result.reason })
  }
  imported.sort((a, b) => {
    const ka = a.createdUtc ?? a.runId
    const kb = b.createdUtc ?? b.runId
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  let store = await readStore(projectRoot)
  const summary = EMPTY_SUMMARY()
  let changed = false
  for (const run of imported) {
    const result = ingestRun(store, run)
    if (result.store !== store) changed = true
    store = result.store
    for (const { outcome } of result.outcomes) summary[outcome] += 1
  }
  if (changed) store = await writeStore(projectRoot, store)
  return { store, summary, unavailable }
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') options.project = argv[++i]
    else throw new Error('sync: unknown argument ' + argv[i])
  }
  if (!options.project) throw new Error('sync: --project <path> is required')
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { project } = parseArgs(process.argv.slice(2))
  syncProject(project)
    .then(({ store, summary, unavailable }) => {
      console.log(JSON.stringify({ summary, unavailable, issueCount: store.issues.length }))
    })
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-sync.test.mjs`
Expected: PASS — `issues-sync: ok`

Then the whole suite the way CI runs it:

```bash
for t in tests/*/*.test.mjs; do echo "--- $t"; node "$t" || exit 1; done
```

Expected: exit 0.

- [ ] **Step 5: Wire the post-run summary, then commit**

In `plugins/secaudit/skills/run/SKILL.md` Step 4, after the CONFIRMED / REFUTED / MANUAL REVIEW
counts, add a paragraph instructing the launcher to run
`node "<PLUGIN_ROOT>/skills/issues/scripts/sync.mjs" --project "<projectRoot>"` and report its
five summary numbers verbatim, with these rules stated in the SKILL text:

- A `repeat` is a finding the board already knows about — never describe it as new.
- `suppressed` counts observations matching an issue a human already marked a false positive; they stay archived and are not raised again.
- `reopened` counts issues a human had marked done that a later run found again.
- `ambiguous` counts observations whose cross-run identity could not be established with confidence; they need an explicit human merge decision on the board.
- Name every `unavailable` run and its reason rather than omitting it.

```bash
git add plugins/secaudit/skills/issues/scripts/sync.mjs \
        plugins/secaudit/skills/run/SKILL.md tests/secaudit/issues-sync.test.mjs
git commit -m "feat(secaudit): project sync entry point and repeat-aware post-run summary

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

---

### Task 7: Human false positives never come back

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/known-issues.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/report-data.schema.json`
- Modify: `plugins/secaudit/skills/run/scripts/secaudit-runtime.mjs`
- Modify: `plugins/secaudit/workflows/secaudit.js`
- Test: `tests/secaudit/issues-known-issues.test.mjs` (create), `tests/secaudit/artifact-publisher.test.mjs` (append)

**Interfaces:**
- Consumes: `readStore` (Task 5), `computeAnchor`/`fingerprintFor` (Task 2), `annotateAnchors` (Task 3).
- Produces:
  - `suppressedIndex(projectRoot)` → `Promise<Map<fingerprint, {issueId, class, path, title, suppressedUtc}>>` — every fingerprint of every `suppressed` issue.
  - `writeKnownIssuesDigest(projectRoot, work)` → `Promise<{path, count}>` — writes `<work>/sast/known-issues.md`, an advisory list for the Challenge stage. Writes an explicit "none" file when nothing is suppressed, so a missing file always means a bug rather than an empty archive.
  - `markSuppressed(reportData, index)` → `reportData` — pure; sets `suppressed: true` and `suppressedIssueId` on findings whose anchor fingerprint is in the index.
  - `summaryFor(findings)` gains a fourth count, `dismissed`.

**Why two layers, and which one is load-bearing.** The advisory digest is a hint to a language
model and will hold *most* of the time. The fingerprint match in `publish-artifacts.mjs` is
deterministic and holds *every* time. The deterministic layer is the guarantee; the digest only
saves the Challenger from re-arguing a case a human already closed. Never present the digest as
the mechanism.

**What is deliberately NOT done.** The hunters are not told to skip anything, and a dismissed
finding is neither deleted from `report-data.json` nor given a different `challengeVerdict`. Three
reasons: a hunt that skips known ground stops confirming that open issues still exist, which is
what keeps `lastSeen` fresh and makes reopen-after-done work; rewriting an audit verdict from a
human decision is the exact inversion the spec forbids; and `report-data.json` that quietly
omits findings is no longer the audit record. A dismissed finding stays in `report-data.json`
with its original verdict, carrying `suppressed: true`; it is the dashboard that keeps it off
the board, and the `dismissed` count that keeps it out of the actionable totals.

**The store-side guarantee already exists.** Task 5's `attach()` returns `outcome: 'suppressed'`
without touching `humanState`, and its test asserts a later run cannot unsuppress. This task adds
the assertion that a suppressed identity never reaches the actionable report either, plus the one
gap worth naming out loud: if the offending line is *edited*, its anchor fingerprint changes and
it is a different identity. `findMatch` still routes it to the single resembling `(class, path)`
issue, which absorbs it as `suppressed` — but when several issues share that file and class, it
becomes a new inbox card flagged `ambiguous`. That is correct behaviour (the code changed), not a
suppression leak, and the `ambiguous` flag is how a human sees it and merges.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-known-issues.test.mjs
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { emptyStore, ingestRun, applyTransition, writeStore } =
  await import(join(scripts, 'issue-store.mjs'))
const { suppressedIndex, writeKnownIssuesDigest, markSuppressed } =
  await import(join(scripts, 'known-issues.mjs'))

const SUPPRESSED_FP = 'fp1:' + '1'.repeat(24)
const LIVE_FP = 'fp1:' + '2'.repeat(24)

const observation = (over = {}) => ({
  observationId: 'o1', runId: 'r1', class: 'sqli', path: 'a.py', line: 4,
  title: 'SQL injection', severity: 'High', challengeVerdict: 'DEFECT',
  challengeReason: 'concat', traceVerdict: 'REACHABLE', traceEvidence: 'route',
  impact: 'i', remediation: 'r', dynamicTest: null,
  fingerprint: SUPPRESSED_FP, fingerprintKind: 'anchor', ...over,
})

let store = ingestRun(emptyStore(), {
  runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok',
  observations: [observation(), observation({
    observationId: 'o2', path: 'b.py', fingerprint: LIVE_FP,
  })],
}).store

const suppressedId = store.issues.find(i => i.path === 'a.py').id
store = applyTransition(store, { issueId: suppressedId, action: 'false-positive',
  revision: store.revision, utc: '2026-01-02T00:00:00Z' }).store

const project = mkdtempSync(join(tmpdir(), 'secaudit known-'))
await writeStore(project, store)

// The index carries every fingerprint of every suppressed issue, and nothing else.
const index = await suppressedIndex(project)
assert.ok(index.has(SUPPRESSED_FP))
assert.ok(!index.has(LIVE_FP))
assert.equal(index.get(SUPPRESSED_FP).issueId, suppressedId)

// The digest is written for the Challenge stage, and names the suppressed finding.
const work = mkdtempSync(join(tmpdir(), 'secaudit known-work-'))
mkdirSync(join(work, 'sast'), { recursive: true })
const digest = await writeKnownIssuesDigest(project, work)
assert.equal(digest.count, 1)
const digestText = readFileSync(digest.path, 'utf8')
assert.ok(digestText.includes('a.py'))
assert.ok(!digestText.includes('b.py'), 'only suppressed issues belong in the digest')

// An empty archive still writes a file: a missing digest must always mean a bug.
const cleanProject = mkdtempSync(join(tmpdir(), 'secaudit known-clean-'))
const cleanWork = mkdtempSync(join(tmpdir(), 'secaudit known-clean-work-'))
mkdirSync(join(cleanWork, 'sast'), { recursive: true })
const emptyDigest = await writeKnownIssuesDigest(cleanProject, cleanWork)
assert.equal(emptyDigest.count, 0)
assert.ok(readFileSync(emptyDigest.path, 'utf8').length > 0)

// Marking is deterministic and leaves the audit's own verdict untouched.
const marked = markSuppressed({
  findings: [
    { class: 'sqli', path: 'a.py', line: 4, challengeVerdict: 'DEFECT',
      anchor: { fingerprint: SUPPRESSED_FP } },
    { class: 'sqli', path: 'b.py', line: 9, challengeVerdict: 'DEFECT',
      anchor: { fingerprint: LIVE_FP } },
    { class: 'idor', path: 'c.py', line: 1, challengeVerdict: 'DEFECT', anchor: null },
  ],
}, index)
assert.equal(marked.findings[0].suppressed, true)
assert.equal(marked.findings[0].suppressedIssueId, suppressedId)
assert.equal(marked.findings[0].challengeVerdict, 'DEFECT', 'the audit verdict is not rewritten')
assert.equal(marked.findings[1].suppressed, false)
// An unanchored finding cannot be matched, so it is never claimed as suppressed.
assert.equal(marked.findings[2].suppressed, false)

console.log('issues-known-issues: ok')
```

Append to `tests/secaudit/artifact-publisher.test.mjs`:

```js
// --- a dismissed identity never reaches the actionable counts --------------
{
  const fixture = await makeRun()
  // Suppress the first finding by the fingerprint the publisher is about to compute for it.
  const { computeAnchor, fingerprintFor } =
    await import(join(pluginRoot, 'skills/issues/scripts/fingerprint.mjs'))
  const { emptyStore, writeStore } =
    await import(join(pluginRoot, 'skills/issues/scripts/issue-store.mjs'))
  const target = JSON.parse(
    readFileSync(join(fixture.work, 'sast', 'report-data.json'), 'utf8')).findings[0]
  const anchor = computeAnchor({
    sourceText: readFileSync(join(fixture.work, ...target.path.split('/')), 'utf8'),
    line: target.line,
    path: target.path,
  })
  await writeStore(fixture.projectRoot, {
    ...emptyStore(),
    issues: [{
      id: 'iss_suppressed', class: target.class, path: target.path, line: target.line,
      title: target.title, severity: null, humanState: 'suppressed', ambiguous: false,
      fingerprints: [fingerprintFor({ class: target.class, path: target.path, ...anchor })],
      observations: [], evidence: {}, firstSeenRunId: 'old', lastSeenRunId: 'old',
      lastHumanUtc: '2026-01-01T00:00:00Z', events: [],
    }],
  })

  const summary = await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  assert.equal(summary.dismissed, 1)
  const published = JSON.parse(
    readFileSync(join(fixture.work, 'sast', 'report-data.json'), 'utf8'))
  const dismissed = published.findings.find(f => f.suppressed)
  // Still in the record, with its original verdict — grouped away, not deleted or rewritten.
  assert.ok(dismissed)
  assert.equal(dismissed.suppressedIssueId, 'iss_suppressed')
  assert.equal(dismissed.challengeVerdict, target.challengeVerdict)
  // And it is not counted among the findings the operator is being asked to act on.
  assert.equal(summary.confirmed + summary.refuted + summary.manualReview,
    published.findings.length - 1)

  console.log('artifact-publisher dismissal: ok')
}
```

`fixture.projectRoot` must be the marker's `projectRoot`; extend the file's `makeRun()` helper to
return it. `pluginRoot` is the plugin directory constant the file already computes.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-known-issues.test.mjs`
Expected: FAIL — cannot find module `known-issues.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/known-issues.mjs
// What a human already dismissed. Two consumers, and they are not equally trustworthy:
// publish-artifacts matches fingerprints deterministically (the guarantee), while the Challenge
// stage reads a digest as advice (a courtesy, so it stops re-arguing a closed case). Never rely
// on the digest for the guarantee — a prompt is not an access control.
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readStore } from './issue-store.mjs'

export async function suppressedIndex(projectRoot) {
  const store = await readStore(projectRoot)
  const index = new Map()
  for (const issue of store.issues) {
    if (issue.humanState !== 'suppressed') continue
    for (const fingerprint of issue.fingerprints) {
      index.set(fingerprint, {
        issueId: issue.id,
        class: issue.class,
        path: issue.path,
        title: issue.title,
        suppressedUtc: issue.lastHumanUtc,
      })
    }
  }
  return index
}

const HEADER = [
  '# Known false positives',
  '',
  'A human reviewed each finding below in an earlier audit and dismissed it. Do not spend',
  'effort re-arguing them. Report what you find as normal — a deterministic fingerprint match',
  'at publication time groups these out of the actionable results, so nothing here depends on',
  'your judgement. This file is advice, not a filter, and it is not evidence about the code.',
  '',
]

export async function writeKnownIssuesDigest(projectRoot, work) {
  const index = await suppressedIndex(projectRoot)
  const entries = [...index.values()]
    .filter((value, i, all) => all.findIndex(v => v.issueId === value.issueId) === i)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const lines = entries.length === 0
    ? ['_No findings have been dismissed in this project._', '']
    : [...entries.map(e => '- `' + e.class + '` ' + e.path + ' — ' + e.title
        + ' (dismissed ' + (e.suppressedUtc ?? 'date not recorded') + ', issue ' + e.issueId + ')'), '']
  const dir = join(work, 'sast')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'known-issues.md')
  await writeFile(path, [...HEADER, ...lines].join('\n'), 'utf8')
  return { path, count: entries.length }
}

// Pure. A finding with no anchor has no comparable identity, so it is never claimed as
// suppressed — an unanchored guess is exactly the false silence this feature must avoid.
export function markSuppressed(reportData, index) {
  return {
    ...reportData,
    findings: reportData.findings.map(finding => {
      const hit = finding.anchor?.fingerprint ? index.get(finding.anchor.fingerprint) : undefined
      return {
        ...finding,
        suppressed: Boolean(hit),
        suppressedIssueId: hit?.issueId ?? null,
      }
    }),
  }
}
```

In `report-contract.mjs`, accept and validate the two new optional fields inside
`validateFinding`:

```js
  requireValue(finding.suppressed === undefined || typeof finding.suppressed === 'boolean',
    'finding.suppressed must be a boolean when present')
  requireValue(
    finding.suppressedIssueId === undefined || finding.suppressedIssueId === null
      || nonEmpty(finding.suppressedIssueId),
    'finding.suppressedIssueId must be a non-empty string or null',
  )
```

and add the fourth count to `summaryFor`:

```js
export function summaryFor(findings) {
  const counts = { confirmed: 0, refuted: 0, manualReview: 0, dismissed: 0 }
  for (const finding of findings) {
    // A finding a human already dismissed is counted once, here, and nowhere else. Leaving it
    // in the actionable buckets as well is what makes a board look like it never shrinks.
    if (finding.suppressed) { counts.dismissed += 1; continue }
    const { bucket } = classifyFinding(finding)
    if (bucket === 'confirmed') counts.confirmed += 1
    else if (bucket === 'refuted') counts.refuted += 1
    else counts.manualReview += 1
  }
  return counts
}
```

Mirror the two fields in `report-data.schema.json`, inside the finding `properties` object:

```json
        "suppressed": { "type": "boolean" },
        "suppressedIssueId": { "type": ["string", "null"] }
```

In `publish-artifacts.mjs`, apply the index right after anchors are computed — the marker
already knows the project root, so nothing new has to be passed in:

```js
import { suppressedIndex, markSuppressed } from '../../issues/scripts/known-issues.mjs'
```

```js
  // Anchors first, then dismissal: a finding cannot be matched against the archive until it
  // has an identity. Both happen before the prune, while the source copy still exists.
  const anchored = await annotateAnchors(reportData, work)
  const projectRoot = marker.projectRoot ?? marker.artifactRoot ?? runDir
  const dismissed = markSuppressed(anchored, await suppressedIndex(projectRoot))
  validateReportData(dismissed)
  await atomicWrite(reportDataPath, JSON.stringify(dismissed, null, 2) + '\n')
```

and compute the returned summary from `dismissed.findings` rather than `reportData.findings`.

In `secaudit-runtime.mjs`'s `prepare()`, write the digest after the work tree is copied:

```js
  // Written into the work tree so the Challenge stage can read it, and so it survives the prune
  // as part of the run's evidence: what was dismissed going in is part of what happened.
  const { writeKnownIssuesDigest } = await import('../../issues/scripts/known-issues.mjs')
  const knownIssues = await writeKnownIssuesDigest(artifactRoot, work)
```

and add `knownIssues` to the returned JSON.

In `workflows/secaudit.js`, extend the Challenge prompt with one advisory sentence:

```js
  `Read ${work}/sast/known-issues.md first: a human already dismissed those findings in an ` +
  `earlier audit, so do not spend effort re-arguing them. It is advice only — report what you ` +
  `find as normal, and never treat that file as evidence about the code.`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-known-issues.test.mjs && node tests/secaudit/artifact-publisher.test.mjs && node tests/secaudit/report-contract.test.mjs && node tests/secaudit/generate-artifacts-integration.test.mjs`
Expected: PASS.

The workflow's `artifacts:publish` agent schema requires `{confirmed, refuted, manualReview}`;
add `dismissed` to its `properties` and to the `note(...)` line so the fourth count reaches the
ledger, then run `node tests/secaudit/validate-workflow.test.mjs`.

Finally the whole suite:

```bash
for t in tests/*/*.test.mjs; do echo "--- $t"; node "$t" || exit 1; done
```

- [ ] **Step 5: Commit**

Stage `known-issues.mjs`, the whole `secaudit-generate-artifacts` skill directory,
`secaudit-runtime.mjs`, `workflows/secaudit.js`, and the two test files, then commit with the
message `feat(secaudit): dismissed findings stay dismissed across runs` plus the repository's
standard `Co-Authored-By` trailer.

## Out of scope for this plan

The dashboard itself: Part 3, `2026-09-10-secaudit-workbench-dashboard.md`.

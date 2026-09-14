# secaudit Run Lifecycle Implementation Plan (Part 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one immutable run context own target, scope, output, work tree, and source hash end to end, so no stage invents a staging copy and every run records whether it published and cleaned up.

**Architecture:** Extend the existing ownership marker (`secaudit-run.json`) from a preparation record into a lifecycle record with an explicit state machine (`preparing` → `prepared` → `published` → `complete`, plus `cleanup-incomplete`). Add first-class `--scope` selection to `prepare` so auditing a subset never requires a hand-staged directory outside the runtime, which is what previously destroyed project identity. `publish-artifacts.mjs` advances the marker and verifies its own cleanup instead of returning success blindly.

**Tech Stack:** Node.js 22+, ESM (`.mjs`), zero runtime dependencies. Tests are plain `node:test`-free scripts using `node:assert` executed as `node tests/secaudit/<name>.test.mjs` (CI loops `tests/*/*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-10-secaudit-workbench-design.md`

## Global Constraints

- Node.js 22 or newer; no new runtime dependencies (the plugin ships zero-dependency `.mjs` scripts).
- Every failure path throws `RuntimeError` with a stable machine-readable code, documented in the CLI `USAGE` block of `secaudit-runtime.mjs`.
- Paths containing spaces must work; all tests create temp dirs with a space in the name (`mkdtempSync(join(tmpdir(), 'secaudit prepare-'))`).
- `--output` keeps its documented meaning: the exact run directory, not a parent.
- The publication gate stays intact: a changed corpus aborts publication and pruning; no partial publish, no prune.
- Historical marker files (`formatVersion: 1`) must remain readable. Never rewrite a historical run's marker.
- Windows, macOS, Linux all run this suite in CI; use `node:path` joins, never string concatenation of separators.
- The audited repository is untrusted data. Never execute or interpolate its contents.

---

### Task 1: Marker format v2 with a lifecycle state machine

**Files:**
- Modify: `plugins/secaudit/skills/run/scripts/run-paths.mjs`
- Test: `tests/secaudit/runtime-marker-lifecycle.test.mjs` (create)

**Interfaces:**
- Consumes: existing `readMarker(dir)`, `writeMarker(dir, fields)`.
- Produces:
  - `MARKER_FORMAT_VERSION = 2` and `SUPPORTED_MARKER_VERSIONS = new Set([1, 2])`
  - `RUN_STATES = ['preparing', 'prepared', 'published', 'complete', 'cleanup-incomplete']`
  - `assertTransition(from, to)` → `void`, throws `RuntimeError('E_RUN_STATE', …)`
  - `updateMarker(dir, fields)` → `Promise<object>` — reads the existing marker, validates the state transition when `fields.state` is present, merges, writes v2, returns the merged marker.

- [ ] **Step 1: Write the failing test**

Create `tests/secaudit/runtime-marker-lifecycle.test.mjs`:

```js
// tests/secaudit/runtime-marker-lifecycle.test.mjs
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'run', 'scripts')
const {
  readMarker, writeMarker, updateMarker, assertTransition,
  MARKER_FORMAT_VERSION, RuntimeError,
} = await import(join(scripts, 'run-paths.mjs'))

const dir = mkdtempSync(join(tmpdir(), 'secaudit marker-'))

// New markers are written at v2.
await writeMarker(dir, { runId: 'r1', target: '/t', state: 'preparing' })
assert.equal(JSON.parse(readFileSync(join(dir, 'secaudit-run.json'), 'utf8')).formatVersion, 2)
assert.equal(MARKER_FORMAT_VERSION, 2)

// v1 markers stay readable: history must not become unreadable.
const legacy = mkdtempSync(join(tmpdir(), 'secaudit legacy-'))
writeFileSync(join(legacy, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 1, runId: 'old', target: '/t', state: 'prepared',
}), 'utf8')
assert.equal((await readMarker(legacy)).runId, 'old')

// updateMarker merges and advances.
await updateMarker(dir, { state: 'prepared', corpusSha256: 'a'.repeat(64) })
const advanced = await updateMarker(dir, { state: 'published' })
assert.equal(advanced.state, 'published')
assert.equal(advanced.runId, 'r1')
assert.equal(advanced.corpusSha256, 'a'.repeat(64))

// Illegal transitions are refused with a stable code, and disk is untouched.
assert.throws(() => assertTransition('prepared', 'complete'), err => {
  assert.ok(err instanceof RuntimeError)
  assert.equal(err.code, 'E_RUN_STATE')
  return true
})
await assert.rejects(updateMarker(dir, { state: 'preparing' }), err => err.code === 'E_RUN_STATE')
assert.equal((await readMarker(dir)).state, 'published')

// A run can be marked cleanup-incomplete from published, and complete only from published.
await updateMarker(dir, { state: 'complete' })
assert.equal((await readMarker(dir)).state, 'complete')

console.log('runtime-marker-lifecycle: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/runtime-marker-lifecycle.test.mjs`
Expected: FAIL — `updateMarker is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `plugins/secaudit/skills/run/scripts/run-paths.mjs`, replace the version constant and add the state machine below `writeMarker`:

```js
export const MARKER_NAME = 'secaudit-run.json'
export const MARKER_FORMAT_VERSION = 2
// v1 markers are historical runs. They are read, never rewritten: a past run's record of
// what it did is evidence, and migrating it in place would fabricate lifecycle facts.
export const SUPPORTED_MARKER_VERSIONS = new Set([1, 2])

export const RUN_STATES = ['preparing', 'prepared', 'published', 'complete', 'cleanup-incomplete']

// Forward-only. `complete` requires publication AND successful cleanup, so nothing reaches it
// from `prepared`: a run that never published has no source copy worth calling cleaned up.
const ALLOWED_TRANSITIONS = new Map([
  ['preparing', new Set(['prepared', 'cleanup-incomplete'])],
  ['prepared', new Set(['published', 'cleanup-incomplete'])],
  ['published', new Set(['complete', 'cleanup-incomplete'])],
  ['complete', new Set([])],
  ['cleanup-incomplete', new Set(['complete'])],
])

export function assertTransition(from, to) {
  if (!RUN_STATES.includes(to)) throw new RuntimeError('E_RUN_STATE', 'unknown run state: ' + to)
  if (from === to) return
  if (!ALLOWED_TRANSITIONS.get(from)?.has(to)) {
    throw new RuntimeError('E_RUN_STATE', 'illegal run state transition: ' + from + ' -> ' + to)
  }
}
```

Change `readMarker`'s envelope check to accept any supported version:

```js
    if (parsed.marker === 'secaudit-run' && SUPPORTED_MARKER_VERSIONS.has(parsed.formatVersion)) {
      return parsed
    }
```

Add `updateMarker` after `writeMarker`:

```js
// Merge-and-advance. Callers past `prepare` own only their own fields; everything the run
// already recorded is carried forward so a later stage cannot erase preparation facts.
export async function updateMarker(dir, fields) {
  const current = await readMarker(dir)
  if (!current) {
    throw new RuntimeError('E_RUN_MARKER_MISSING',
      'not a secaudit run directory (missing or invalid ' + MARKER_NAME + '): ' + dir)
  }
  if (fields.state) assertTransition(current.state, fields.state)
  const { marker, formatVersion, ...rest } = current
  return writeMarker(dir, { ...rest, ...fields })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/runtime-marker-lifecycle.test.mjs`
Expected: PASS — `runtime-marker-lifecycle: ok`

Then run the neighbours that read markers:
`node tests/secaudit/runtime-paths.test.mjs && node tests/secaudit/runtime-prepare.test.mjs && node tests/secaudit/artifact-publisher.test.mjs`
Expected: PASS. If a test asserts `formatVersion: 1` on a freshly written marker, update that assertion to `2` — but never relax a test that asserts a v1 marker is still *readable*.

Also update the inline copy of the envelope check in `plugins/secaudit/skills/run/scripts/source-corpus.mjs` so an undeclared v2 marker directory is still detected:

```js
const RUN_MARKER_NAME = 'secaudit-run.json'
// Mirrors run-paths.mjs' SUPPORTED_MARKER_VERSIONS, inlined so this stays a leaf module.
const RUN_MARKER_FORMAT_VERSIONS = new Set([1, 2])
```

and in `isRunMarkerDir`:

```js
    return parsed.marker === 'secaudit-run' && RUN_MARKER_FORMAT_VERSIONS.has(parsed.formatVersion)
```

Run: `node tests/secaudit/runtime-source-corpus.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/run/scripts/run-paths.mjs \
        plugins/secaudit/skills/run/scripts/source-corpus.mjs \
        tests/secaudit/runtime-marker-lifecycle.test.mjs
git commit -m "feat(secaudit): marker v2 with a forward-only run lifecycle state machine

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `--scope` selection inside the runtime

**Files:**
- Modify: `plugins/secaudit/skills/run/scripts/source-corpus.mjs`
- Test: `tests/secaudit/runtime-source-corpus.test.mjs` (append)

**Interfaces:**
- Consumes: `enumerateSource(root, { extraExcluded })`.
- Produces: `enumerateSource(root, { extraExcluded = [], scope = [] })` where `scope` is an array of POSIX-relative directory or file paths under `root`. Empty `scope` means the whole tree (unchanged behaviour). Return shape gains `scope: string[]` (normalized, sorted) and `scopeMisses: string[]` (requested entries that matched nothing).

This is the mechanism that removes hand-staged copies: a scoped audit stays rooted at the real target, so project identity, artifact root, and the corpus hash all keep referring to the real repository.

- [ ] **Step 1: Write the failing test**

Append to `tests/secaudit/runtime-source-corpus.test.mjs`:

```js
// --- scope selection -------------------------------------------------------
{
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit scope-')))
  mkdirSync(join(root, 'api', 'deep'), { recursive: true })
  mkdirSync(join(root, 'web'), { recursive: true })
  writeFileSync(join(root, 'api', 'a.py'), 'a = 1\n', 'utf8')
  writeFileSync(join(root, 'api', 'deep', 'b.py'), 'b = 1\n', 'utf8')
  writeFileSync(join(root, 'web', 'c.js'), 'c\n', 'utf8')
  writeFileSync(join(root, 'root.py'), 'r = 1\n', 'utf8')

  const all = await enumerateSource(root)
  assert.deepEqual(all.files, ['api/a.py', 'api/deep/b.py', 'root.py', 'web/c.js'])
  assert.deepEqual(all.scope, [])

  const scoped = await enumerateSource(root, { scope: ['api'] })
  assert.deepEqual(scoped.files, ['api/a.py', 'api/deep/b.py'])
  assert.deepEqual(scoped.scope, ['api'])
  assert.deepEqual(scoped.scopeMisses, [])

  // A single file is a valid scope entry.
  const oneFile = await enumerateSource(root, { scope: ['root.py'] })
  assert.deepEqual(oneFile.files, ['root.py'])

  // Nonexistent scope entries are reported, not silently ignored.
  const missing = await enumerateSource(root, { scope: ['api', 'nope'] })
  assert.deepEqual(missing.scopeMisses, ['nope'])

  // Scope never escapes the root.
  await assert.rejects(enumerateSource(root, { scope: ['../elsewhere'] }),
    err => /scope entry escapes the target/.test(err.message))

  console.log('source-corpus scope: ok')
}
```

Ensure the file's existing imports include `mkdirSync` and `realpathSync`; add them to the `node:fs` import list if absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/runtime-source-corpus.test.mjs`
Expected: FAIL — `scoped.files` still lists all four files, `scope` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `source-corpus.mjs`, add the normalizer above `enumerateSource`:

```js
// Scope entries are POSIX-relative paths under the target. They restrict WHAT IS READ; they
// never move the root, so the project identity, artifact root, and corpus hash keep pointing
// at the real repository — which is exactly what hand-staging a copy used to destroy.
function normalizeScope(root, scope) {
  const normalized = []
  for (const raw of scope) {
    const rel = raw.split(sep).join('/').replace(/^\.\/+/, '').replace(/\/+$/, '')
    if (rel === '' || rel === '.') return [] // an explicit whole-tree scope
    const abs = join(root, ...rel.split('/'))
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error('scope entry escapes the target: ' + raw)
    }
    normalized.push(rel)
  }
  return [...new Set(normalized)].sort()
}

function inScope(rel, scope) {
  if (scope.length === 0) return true
  return scope.some(s => rel === s || rel.startsWith(s + '/'))
}

// True when a directory could still contain in-scope files, so recursion is not pruned early.
function scopeTouchesDir(rel, scope) {
  if (scope.length === 0) return true
  return scope.some(s => rel === '' || s === rel || s.startsWith(rel + '/') || rel.startsWith(s + '/'))
}
```

Change the `enumerateSource` signature and body:

```js
export async function enumerateSource(root, { extraExcluded = [], scope = [] } = {}) {
  const normalizedScope = normalizeScope(root, scope)
  const prefixes = extraExcluded.map(p => (p.endsWith(sep) ? p : p + sep))
  const seenScope = new Set()
  // …existing declarations unchanged…
```

Inside `recurse`, gate directory recursion and file collection:

```js
      if (entry.isSymbolicLink()) {
        if (!inScope(rel, normalizedScope)) continue
        // …existing symlink handling unchanged…
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) {
          excludedDirsHit.add(entry.name)
          continue
        }
        if (prefixes.some(p => (abs + sep).startsWith(p))) continue
        if (!scopeTouchesDir(rel, normalizedScope)) continue
        if (inScope(rel, normalizedScope)) seenScope.add(matchedScopeEntry(rel, normalizedScope))
        await recurse(abs, false)
      } else if (entry.isFile()) {
        if (!inScope(rel, normalizedScope)) continue
        seenScope.add(matchedScopeEntry(rel, normalizedScope))
        files.push(rel)
      }
```

Add the helper next to `inScope`:

```js
function matchedScopeEntry(rel, scope) {
  return scope.find(s => rel === s || rel.startsWith(s + '/'))
}
```

And extend the return value:

```js
  return {
    files: [...files].sort(),
    internalSymlinks: [...internalSymlinks].sort(),
    externalSymlinks: [...externalSymlinks].sort(),
    excludedDirsHit: [...excludedDirsHit].sort(),
    excludedRunDirs: [...excludedRunDirs].sort(),
    scope: normalizedScope,
    scopeMisses: normalizedScope.filter(s => !seenScope.has(s)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/runtime-source-corpus.test.mjs`
Expected: PASS — `source-corpus scope: ok`

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/run/scripts/source-corpus.mjs tests/secaudit/runtime-source-corpus.test.mjs
git commit -m "feat(secaudit): scope-limited enumeration rooted at the real target

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `prepare --scope` persists one immutable run context

**Files:**
- Modify: `plugins/secaudit/skills/run/scripts/secaudit-runtime.mjs`
- Test: `tests/secaudit/runtime-prepare.test.mjs` (append)

**Interfaces:**
- Consumes: `enumerateSource(root, { extraExcluded, scope })` (Task 2), `updateMarker` (Task 1).
- Produces:
  - CLI: `prepare --target <path> [--output <exact-run-directory>] [--scope <rel-path>]…` (`--scope` repeatable; also accepts one comma-separated value).
  - `inspect --target <path> [--scope <rel-path>]…` reports scoped coverage.
  - `prepare` JSON result gains `scope: string[]` and `projectRoot: string` (alias of `artifactRoot`, named for the spec's run context).
  - Marker at `prepared` gains `work`, `scope`, `projectRoot`, `runtimeVersion: 2`.
  - New error code `E_SCOPE_EMPTY` when a scope selects no files, and `E_SCOPE_UNKNOWN` when a scope entry matches nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/secaudit/runtime-prepare.test.mjs`:

```js
// --- scoped prepare --------------------------------------------------------
{
  const scopedTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit scoped-')))
  mkdirSync(join(scopedTarget, 'api'))
  mkdirSync(join(scopedTarget, 'web'))
  writeFileSync(join(scopedTarget, 'api', 'a.py'), 'a = 1\n', 'utf8')
  writeFileSync(join(scopedTarget, 'web', 'b.py'), 'b = 1\n', 'utf8')
  execFileSync('git', [...gitEnv, 'init', '-q', scopedTarget])

  const out = JSON.parse(execFileSync('node', [cli, 'prepare', '--target', scopedTarget,
    '--scope', 'api'], { encoding: 'utf8' }))

  assert.deepEqual(out.scope, ['api'])
  // The run context names the real project, not a staging directory.
  assert.equal(out.projectRoot, scopedTarget)
  assert.equal(out.target, scopedTarget)
  // Only in-scope source was copied.
  assert.ok(existsSync(join(out.work, 'api', 'a.py')))
  assert.ok(!existsSync(join(out.work, 'web', 'b.py')))
  assert.equal(out.coverage.sourceFiles, 1)

  const marker = JSON.parse(readFileSync(join(out.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'prepared')
  assert.deepEqual(marker.scope, ['api'])
  assert.equal(marker.work, out.work)
  assert.equal(marker.projectRoot, scopedTarget)

  // A scope entry that matches nothing is refused before anything is written.
  const bad = JSON.parse(execFileSync('node', [cli, 'prepare', '--target', scopedTarget,
    '--scope', 'nope'], { encoding: 'utf8' }).toString())
  assert.equal(bad.error.code, 'E_SCOPE_UNKNOWN')

  console.log('runtime-prepare scope: ok')
}
```

Note: `execFileSync` throws on a non-zero exit; wrap the failing case:

```js
  let bad
  try {
    execFileSync('node', [cli, 'prepare', '--target', scopedTarget, '--scope', 'nope'],
      { encoding: 'utf8' })
    assert.fail('expected a non-zero exit for an unmatched scope entry')
  } catch (err) {
    bad = JSON.parse(err.stdout)
  }
  assert.equal(bad.error.code, 'E_SCOPE_UNKNOWN')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/runtime-prepare.test.mjs`
Expected: FAIL — `unknown argument: --scope`.

- [ ] **Step 3: Write minimal implementation**

In `secaudit-runtime.mjs`, make `parseArgs` accept a repeatable `--scope`:

```js
function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = { '--target': 'target', '--output': 'output' }
  const options = { command, scope: [] }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--help') {
      options.help = true
      continue
    }
    if (rest[i] === '--scope') {
      const value = rest[++i]
      if (value == null) throw new RuntimeError('E_USAGE', 'missing value for --scope')
      // Repeatable, and one flag may carry a comma-separated list — operators type both.
      options.scope.push(...value.split(',').map(s => s.trim()).filter(Boolean))
      continue
    }
    const key = flags[rest[i]]
    if (!key) throw new RuntimeError('E_USAGE', 'unknown argument: ' + rest[i])
    const value = rest[++i]
    if (value == null) throw new RuntimeError('E_USAGE', 'missing value for ' + rest[i - 1])
    options[key] = value
  }
  return options
}
```

Add a shared scope gate near `undeclaredRunDirMessage`:

```js
// Scope mistakes must never degrade quietly into a wider or narrower audit than the operator
// asked for: a typo that silently audits nothing is a false all-clear.
function assertScopeUsable({ scope, scopeMisses }, coverage) {
  if (scopeMisses.length > 0) {
    throw new RuntimeError('E_SCOPE_UNKNOWN',
      'scope entries matched nothing under the target: ' + scopeMisses.join(', ')
      + ' — check the paths (they are relative to the target, forward-slashed) and re-run')
  }
  if (scope.length > 0 && coverage.sourceFiles === 0) {
    throw new RuntimeError('E_SCOPE_EMPTY',
      'the selected scope contains no recognized source files: ' + scope.join(', '))
  }
}
```

In `inspect`, pass the scope through and report it:

```js
  const { files, internalSymlinks, externalSymlinks, excludedDirsHit, excludedRunDirs, scope,
    scopeMisses } = await enumerateSource(target, { scope: options.scope ?? [] })
```

and add `scope`, `scopeMisses` to the returned object, plus a warning when `scopeMisses.length`:

```js
  if (scopeMisses.length > 0) {
    warnings.push('scope entries matched nothing under the target: ' + scopeMisses.join(', ')
      + ' — prepare will refuse until they are corrected')
  }
```

In `prepare`, thread scope through enumeration, gate it, and persist the full context:

```js
  const { files, internalSymlinks, externalSymlinks, excludedRunDirs, scope, scopeMisses } =
    await enumerateSource(target, { extraExcluded, scope: options.scope ?? [] })
  if (excludedRunDirs.length > 0) {
    throw new RuntimeError('E_UNDECLARED_RUN_DIR', undeclaredRunDirMessage(excludedRunDirs))
  }
  const coverage = await measureSource(target, files)
  assertScopeUsable({ scope, scopeMisses }, coverage)
```

Replace the second `writeMarker` call with the full context and add the new fields to the result:

```js
  await writeMarker(runDir, {
    runId,
    target,
    createdUtc: nowIso,
    state: 'prepared',
    insideTarget,
    projectRoot: artifactRoot,
    artifactRoot,
    artifactRootSource,
    scope,
    work,
    coverage,
    corpusSha256,
    skippedExternalSymlinks: externalSymlinks,
  })
  return {
    runId,
    runDir,
    work,
    target,
    projectRoot: artifactRoot,
    scope,
    coverage,
    corpusSha256,
    generatedDate,
    insideTarget,
    artifactRoot,
    artifactRootSource,
    skippedExternalSymlinks: externalSymlinks,
    excludedRunDirs,
    internalSymlinks,
    degradedSymlinks,
  }
```

Update `USAGE` — both the synopsis and the error-code list:

```js
const USAGE = `Usage:
  node secaudit-runtime.mjs inspect --target <path> [--scope <relative-path>]...
  node secaudit-runtime.mjs prepare --target <path> [--output <exact-run-directory>] [--scope <relative-path>]...

inspect is read-only: it reports source measurements, recognized manifests, and
the exclusions that would apply, and never writes to the target.
prepare validates, hashes, creates the run directory + ownership marker, and
copies the source into an isolated work tree. Without --output the run directory
defaults to <project-root>/.secaudit/runs/<run-id>, where project root is the
target's own Git toplevel, else the Git toplevel above the current directory
(so auditing a staged copy still reports into the real repository), else the
target itself.
--scope restricts WHAT IS READ to the given target-relative paths (repeatable,
or one comma-separated value). The target, project root, and corpus hash still
refer to the real repository, so a partial audit never needs a staged copy.

Results: one JSON line on stdout. Diagnostics: stderr.
Failure: exit 1 with {"error":{"code","message"}} on stdout. Codes:
E_USAGE, E_TARGET_MISSING, E_TARGET_NOT_DIRECTORY, E_OUTPUT_IS_TARGET,
E_OUTPUT_CONTAINS_TARGET, E_OUTPUT_NOT_EMPTY_UNOWNED, E_OUTPUT_RUN_EXISTS,
E_UNDECLARED_RUN_DIR, E_WORKTREE_SYMLINK_ESCAPE, E_SCOPE_UNKNOWN,
E_SCOPE_EMPTY, E_RUN_STATE, E_RUN_MARKER_MISSING, E_UNEXPECTED.`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/runtime-prepare.test.mjs && node tests/secaudit/runtime-inspect.test.mjs`
Expected: PASS, including `runtime-prepare scope: ok`.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/run/scripts/secaudit-runtime.mjs tests/secaudit/runtime-prepare.test.mjs
git commit -m "feat(secaudit): prepare --scope and a persisted immutable run context

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Retire the rendered report — the dashboard is the only human view

**Files:**
- Delete: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/render-report.mjs`
- Delete: `plugins/secaudit/skills/secaudit-generate-artifacts/templates/report.md.tmpl`, `templates/report.html.tmpl`
- Delete: `tests/secaudit/report-renderer.test.mjs`, `tests/secaudit/fixtures/report.expected.md`, `tests/secaudit/fixtures/report.expected.html`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/verify-artifacts.mjs`
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/SKILL.md`
- Modify: `plugins/secaudit/workflows/secaudit.js`
- Test: `tests/secaudit/artifact-publisher.test.mjs`, `tests/secaudit/generate-artifacts-integration.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: a run's published deliverables are `<runDir>/trace.md` and `<runDir>/work/sast/report-data.json`. `report.md` and `report.html` are no longer produced. `verifyArtifacts({runDir})` checks those two paths instead of the three old ones.

**Why.** The Workbench is the human view now. A second rendered view of the same
`report-data.json` is a parallel surface to keep in sync, and it was already the weaker one: no
persistence, no cross-run identity, no triage. `report-data.json` stays as the structured record
the dashboard reads, and `trace.md` stays because it is provenance, not a report — corpus hash,
coverage, and the stage ledger, the three things that say what this run actually did.

**Existing runs are untouched.** Historical run directories keep whatever they published. Import
reads only `report-data.json`, so old runs appear in the dashboard either way, and nothing
rewrites what a past audit emitted.

- [ ] **Step 1: Write the failing test**

Replace the artifact assertions in `tests/secaudit/artifact-publisher.test.mjs` and add the
absence check — a deleted surface must be asserted gone, or it quietly comes back:

```js
// --- the run's deliverables ------------------------------------------------
{
  const fixture = await makeRun()
  await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  // Provenance and structured findings, and nothing else.
  assert.ok(existsSync(join(fixture.runDir, 'trace.md')))
  assert.ok(existsSync(join(fixture.work, 'sast', 'report-data.json')))
  assert.ok(!existsSync(join(fixture.runDir, 'report.md')), 'no rendered markdown report')
  assert.ok(!existsSync(join(fixture.runDir, 'report.html')), 'no rendered HTML report')

  console.log('artifact-publisher deliverables: ok')
}
```

And in `tests/secaudit/generate-artifacts-integration.test.mjs`, drop the render step from the
pipeline it exercises and assert the same two deliverables.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/artifact-publisher.test.mjs`
Expected: FAIL — `report.md` still exists, because the publisher still writes it.

- [ ] **Step 3: Write minimal implementation**

Delete the renderer, both templates, the renderer test, and the two expected-output fixtures:

```bash
git rm plugins/secaudit/skills/secaudit-generate-artifacts/scripts/render-report.mjs \
       plugins/secaudit/skills/secaudit-generate-artifacts/templates/report.md.tmpl \
       plugins/secaudit/skills/secaudit-generate-artifacts/templates/report.html.tmpl \
       tests/secaudit/report-renderer.test.mjs \
       tests/secaudit/fixtures/report.expected.md \
       tests/secaudit/fixtures/report.expected.html
```

In `publish-artifacts.mjs`, drop the two `requireFile` checks for `work/sast/final-report.md`
and `work/sast/final-report.html`, drop the `finalMdPath`/`finalHtmlPath` constants, drop the
`readFile` calls that produced `finalMd` and `finalHtml`, and write only the trace:

```js
  const sastDir = join(work, 'sast')
  await requireDirectory(sastDir, 'work/sast')
  const reportDataPath = join(sastDir, 'report-data.json')
  await requireFile(reportDataPath, 'work/sast/report-data.json')
  await requireFile(ledgerPath, 'ledgerPath')
```

In `verify-artifacts.mjs`, change the checked set. It is the independent post-condition on the
deliverables — an agent can narrate a successful publish it never performed, so this must name
the files that actually matter now:

```js
// The deliverables a completed run must leave behind: provenance in the run directory, and the
// structured findings the dashboard reads. Checked by a process with no stake in publish having
// succeeded.
const REQUIRED = [
  { label: 'trace.md', path: runDir => join(runDir, 'trace.md') },
  { label: 'work/sast/report-data.json', path: runDir => join(runDir, 'work', 'sast', 'report-data.json') },
]
```

and keep its existing behaviour of reporting `{sizes, missing}` and exiting non-zero when
`missing` is non-empty.

In `workflows/secaudit.js`, delete the whole `artifacts:render` `robustAgent` call and its
`note('Generate Artifacts / Render: …')` line. Update the verify note and the post-condition
message to name `trace.md` and `work/sast/report-data.json`. Update the final `note(...)` after
publish so it no longer points at `${runDir}/report.md`:

```js
note(`Generate Artifacts / Publish: ${artifactSummary.confirmed} confirmed / ` +
  `${artifactSummary.refuted} refuted / ${artifactSummary.manualReview} manual review → ${runDir}`)
```

In `secaudit-generate-artifacts/SKILL.md`, remove the Render operation from the documented
sequence, leaving Generate (assemble + validate `report-data.json`) → Publish → Verify. Say
plainly that the audit produces structured findings and a trace, and that the human view is
`secaudit:issues`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/artifact-publisher.test.mjs && node tests/secaudit/generate-artifacts-integration.test.mjs && node tests/secaudit/validate-workflow.test.mjs && node tests/secaudit/validate-manifests.test.mjs`
Expected: PASS.

`tests/secaudit/forbidden-references.test.mjs` and the vocabulary tests may still assert the
renderer or the templates exist — update those assertions to assert the opposite, so a
reintroduced renderer fails the suite.

- [ ] **Step 5: Commit**

Stage the deletions plus `publish-artifacts.mjs`, `verify-artifacts.mjs`, the skill's
`SKILL.md`, `workflows/secaudit.js`, and the touched tests, then commit with the message
`refactor(secaudit): retire the rendered report, the dashboard is the human view` plus the
repository's standard `Co-Authored-By` trailer.

---

### Task 5: Publication advances the marker and verifies its own cleanup

**Files:**
- Modify: `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs`
- Test: `tests/secaudit/artifact-publisher.test.mjs` (append)

**Interfaces:**
- Consumes: `updateMarker(dir, fields)`, `readMarker(dir)` from `run-paths.mjs`.
- Produces: `publishArtifacts(options)` returns `{ confirmed, refuted, manualReview, state, cleanup }` where `cleanup` is `{ removed: string[], remaining: string[], ok: boolean }`. The marker reaches `complete` only when cleanup leaves nothing but `sast`; otherwise `cleanup-incomplete`, and the CLI exits non-zero.

The corpus-pristine gate, the ownership gate, and the `.tmp`-then-rename publication order are unchanged. Only the record of what happened is new.

- [ ] **Step 1: Write the failing test**

Append to `tests/secaudit/artifact-publisher.test.mjs` (reuse the existing helper that builds a valid run directory; the snippet below assumes the file's existing `makeRun()`-style setup returning `{ target, runDir, work, ledgerPath, corpus }` — mirror whichever helper the file already defines):

```js
// --- lifecycle + cleanup accounting ----------------------------------------
{
  const fixture = await makeRun()           // existing helper in this file
  writeFileSync(join(fixture.work, 'leftover-source.py'), 'x = 1\n', 'utf8')

  const summary = await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  assert.equal(summary.state, 'complete')
  assert.ok(summary.cleanup.ok)
  assert.ok(summary.cleanup.removed.includes('leftover-source.py'))
  assert.deepEqual(summary.cleanup.remaining, ['sast'])
  assert.ok(!existsSync(join(fixture.work, 'leftover-source.py')))
  assert.ok(existsSync(join(fixture.work, 'sast', 'report-data.json')))

  const marker = JSON.parse(readFileSync(join(fixture.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'complete')
  assert.equal(typeof marker.publishedUtc, 'string')
  assert.deepEqual(marker.artifacts, ['trace.md'])
  assert.equal(marker.cleanup.ok, true)

  console.log('artifact-publisher lifecycle: ok')
}

// --- a non-pristine corpus leaves the marker untouched ----------------------
{
  const fixture = await makeRun()
  writeFileSync(join(fixture.target, 'app.py'), 'mutated = 1\n', 'utf8')

  await assert.rejects(publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  }), /corpus not pristine/)

  const marker = JSON.parse(readFileSync(join(fixture.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'prepared')       // never advanced
  assert.ok(!existsSync(join(fixture.runDir, 'trace.md')))

  console.log('artifact-publisher aborts without advancing state: ok')
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/artifact-publisher.test.mjs`
Expected: FAIL — `summary.state` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `publish-artifacts.mjs`, import `updateMarker` and make the prune report what it did:

```js
import { readMarker, updateMarker, MARKER_NAME } from '../../run/scripts/run-paths.mjs'
```

```js
// The copied source is temporary: it is removed on success and only the audit evidence stays.
// Returning the accounting (rather than nothing) is what lets the run refuse to claim success
// when a leftover survives — an operator who is told "clean" must actually be clean.
async function pruneWorkExceptSast(work) {
  const removed = []
  for (const entry of await readdir(work, { withFileTypes: true })) {
    if (entry.name === 'sast') continue
    await rm(join(work, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  const remaining = (await readdir(work)).sort()
  return { removed: removed.sort(), remaining, ok: remaining.every(name => name === 'sast') }
}
```

Replace the tail of `publishArtifacts`:

```js
  await atomicWrite(join(runDir, 'trace.md'), traceMd)

  const publishedUtc = new Date().toISOString()
  await updateMarker(runDir, {
    state: 'published',
    publishedUtc,
    artifacts: ['trace.md'],
  })

  const cleanup = await pruneWorkExceptSast(work)
  const state = cleanup.ok ? 'complete' : 'cleanup-incomplete'
  await updateMarker(runDir, { state, cleanup })

  return { ...summaryFor(reportData.findings), state, cleanup }
}
```

Remove the now-duplicated `const summary = summaryFor(reportData.findings)` line earlier in the function.

Make the CLI fail loudly on incomplete cleanup:

```js
  publishArtifacts(parseArgs(process.argv.slice(2)))
    .then(result => {
      console.log(JSON.stringify(result))
      if (!result.cleanup.ok) {
        console.error('publish-artifacts: the copied source was NOT fully removed; these entries '
          + 'remain under the work tree: ' + result.cleanup.remaining.join(', ')
          + ' — the run is recorded as cleanup-incomplete, delete them by hand')
        process.exitCode = 1
      }
    })
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/artifact-publisher.test.mjs && node tests/secaudit/generate-artifacts-integration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs \
        tests/secaudit/artifact-publisher.test.mjs
git commit -m "feat(secaudit): record publication and verify source cleanup before claiming success

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Both launch paths carry the run context; documentation stops advising manual staging

**Files:**
- Modify: `plugins/secaudit/skills/run/SKILL.md`
- Modify: `plugins/secaudit/workflows/secaudit.js`
- Modify: `plugins/secaudit/skills/secaudit-orchestrator/SKILL.md`
- Modify: `plugins/secaudit/README.md`
- Test: `tests/secaudit/validate-launcher.test.mjs`, `tests/secaudit/validate-workflow.test.mjs` (append)

**Interfaces:**
- Consumes: `prepare` JSON (`{runId, runDir, work, target, projectRoot, scope, coverage, corpusSha256, generatedDate}`).
- Produces: the workflow accepts and echoes `scope` and `projectRoot`; the launcher SKILL shows target, scope, and final output directory before launching, and asks for scope fresh on every run.

- [ ] **Step 1: Write the failing test**

Append to `tests/secaudit/validate-launcher.test.mjs`:

```js
// The launcher must show the three things an operator cannot recover afterwards, and must
// never restore a previous run's scope silently.
for (const needle of [
  '--scope',
  'Selected scope',
  'never reuse a previous run\'s scope',
]) {
  assert.ok(skill.includes(needle), 'run/SKILL.md must mention: ' + needle)
}
assert.ok(!/stage(d)? a copy|copy the repo/i.test(skill),
  'run/SKILL.md must not advise hand-staging a copy; --scope replaces it')
```

Append to `tests/secaudit/validate-workflow.test.mjs`:

```js
// The workflow must pass the run context through verbatim rather than re-deriving paths.
assert.ok(source.includes('scope'), 'workflow must thread scope through')
assert.ok(!/process\.cwd\(\)/.test(source), 'workflow must never re-derive paths from cwd')
```

(`skill` / `source` are the already-read file contents in those tests; reuse whatever local
variable each file defines.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/validate-launcher.test.mjs`
Expected: FAIL — `run/SKILL.md must mention: --scope`.

- [ ] **Step 3: Write minimal implementation**

In `plugins/secaudit/skills/run/SKILL.md`:

Change the front-matter hint:

```yaml
argument-hint: "[repo-path] [--scope <relative-path>] [--output <exact-run-directory>]"
```

In Step 1, pass scope to inspect:

```
node "<PLUGIN_ROOT>/skills/run/scripts/secaudit-runtime.mjs" inspect --target <repo-path> [--scope <relative-path>]...
```

Add a scope question to Step 2, before the hunter question:

```markdown
0b. **Scope** (single select, ALWAYS ask — never reuse a previous run's scope, and never
   restore one from an earlier run directory; scope is chosen fresh every time).
   Question text: "Audit the whole target, or only part of it? Whole target is
   `<coverage.sourceLines>` source LOC." Options:
   1. **Whole target (Recommended)** — no `--scope`.
   2. **Selected subdirectories** — the user types target-relative paths via Other
      (comma-separated). Re-run Step 1 `inspect` with those `--scope` values and restate
      the size line before continuing; a scope that matches nothing is refused with
      `E_SCOPE_UNKNOWN`, and a scope with no source files with `E_SCOPE_EMPTY`.

   Never hand-stage a copy of the repository to narrow an audit. `--scope` exists precisely
   so the target, project root, and corpus hash keep referring to the real repository.
```

In Step 3, add the flag and the pre-launch summary:

```
node "<PLUGIN_ROOT>/skills/run/scripts/secaudit-runtime.mjs" prepare --target <target> [--scope <relative-path>]... [--output <exact-run-directory>]
```

```markdown
**Before launching, print all three resolved facts** — they are the only chance to redirect
the run:

- `Target: <target>`
- `Selected scope: <scope joined by ", ", or "whole target">`
- `Output: <runDir>`
```

Add `scope` and `projectRoot` to the documented prepare JSON and to the `Workflow({args:…})`
block:

```
    scope: <scope array, verbatim>,
    projectRoot: "<projectRoot>",
```

In Step 4, replace the cleanup paragraph — the runtime now removes the copy itself:

```markdown
When the workflow finishes, report to the user: counts of CONFIRMED / REFUTED / MANUAL REVIEW,
the top 3 CONFIRMED findings, and the paths to `<runDir>/trace.md` (corpus hash, coverage,
stage ledger) and `<runDir>/work/sast/report-data.json` (the structured findings). There is no
rendered report file: the Workbench dashboard is the only human view, opened with
`secaudit:issues`. The copied source is removed automatically on a successful publish;
`<runDir>/work/sast/` keeps the stage evidence. If the run reports state
`cleanup-incomplete`, say so plainly and name the leftover entries — that run still holds a
copy of the audited tree, including its `.env`. Never claim the codebase is "secure."
```

In `plugins/secaudit/workflows/secaudit.js`, accept and thread the new args. Where the other
args are destructured from `args`, add:

```js
const scope = Array.isArray(args.scope) ? args.scope : []
const projectRoot = args.projectRoot ?? null
```

and include them in the Recon note so a dropped scope is visible in the ledger, mirroring the
existing `hunters=` check:

```js
note(`Recon / Prepare: hunters=${HUNTERS.length} scope=${scope.length ? scope.join(',') : 'whole-target'}`)
```

Return them with the workflow result:

```js
return {
  runDir,
  scope,
  projectRoot,
  confirmed: artifactSummary.confirmed,
  // …unchanged…
}
```

In `plugins/secaudit/skills/secaudit-orchestrator/SKILL.md` and `plugins/secaudit/README.md`,
replace any instruction to delete the run directory by hand, or to copy/stage a subset of the
repository, with: scope narrowing uses `--scope`; the copied source is removed automatically on
a successful publish; a run reporting `cleanup-incomplete` needs manual deletion and says which
entries remain.

- [ ] **Step 4: Run test to verify it passes**

Run the whole suite the way CI does:

```bash
for t in tests/*/*.test.mjs; do echo "--- $t"; node "$t" || exit 1; done
```

Expected: every test prints its `ok` line and the loop exits 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/run/SKILL.md plugins/secaudit/workflows/secaudit.js \
        plugins/secaudit/skills/secaudit-orchestrator/SKILL.md plugins/secaudit/README.md \
        tests/secaudit/validate-launcher.test.mjs tests/secaudit/validate-workflow.test.mjs
git commit -m "feat(secaudit): thread scope and run context through both launch paths

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: End-to-end lifecycle test over awkward paths

**Files:**
- Test: `tests/secaudit/runtime-lifecycle-e2e.test.mjs` (create)

**Interfaces:**
- Consumes: the `prepare` CLI and `publishArtifacts()` from the previous tasks.
- Produces: nothing importable — this is the spec's verification checklist as executable code.

- [ ] **Step 1: Write the failing test**

Create `tests/secaudit/runtime-lifecycle-e2e.test.mjs`:

```js
// tests/secaudit/runtime-lifecycle-e2e.test.mjs
// The spec's exercise list: spaces in paths, target subdirectories, a project root separate
// from the corpus root, an explicit external output, and interrupted publication.
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const cli = join(root, 'skills/run/scripts/secaudit-runtime.mjs')
const gitEnv = ['-c', 'user.email=t@t', '-c', 'user.name=t']

function makeRepo(label) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit ' + label + '-')))
  mkdirSync(join(dir, 'api'))
  writeFileSync(join(dir, 'api', 'a.py'), 'a = 1\n', 'utf8')
  writeFileSync(join(dir, 'top.py'), 't = 1\n', 'utf8')
  execFileSync('git', [...gitEnv, 'init', '-q', dir])
  return dir
}

// 1. Explicit external output in a directory whose path contains a space.
{
  const target = makeRepo('e2e-target')
  const outParent = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit e2e out-')))
  const out = join(outParent, 'run one')
  const prepared = JSON.parse(execFileSync('node',
    [cli, 'prepare', '--target', target, '--output', out], { encoding: 'utf8' }))
  assert.equal(prepared.runDir, out)
  assert.equal(prepared.work, join(out, 'work'))
  assert.equal(prepared.projectRoot, target)
  assert.ok(existsSync(join(out, 'work', 'api', 'a.py')))
  // The original source is untouched.
  assert.equal(readFileSync(join(target, 'api', 'a.py'), 'utf8'), 'a = 1\n')
}

// 2. Auditing a subdirectory of the target keeps the project root at the repository root.
{
  const target = makeRepo('e2e-sub')
  const prepared = JSON.parse(execFileSync('node',
    [cli, 'prepare', '--target', join(target, 'api')], { encoding: 'utf8' }))
  assert.equal(prepared.target, join(target, 'api'))
  assert.equal(prepared.projectRoot, target)
  assert.ok(prepared.runDir.startsWith(join(target, '.secaudit', 'runs')))
}

// 3. An interrupted run keeps its diagnostic state: the marker never claims completion.
{
  const target = makeRepo('e2e-interrupt')
  const prepared = JSON.parse(execFileSync('node',
    [cli, 'prepare', '--target', target], { encoding: 'utf8' }))
  const marker = JSON.parse(readFileSync(join(prepared.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'prepared')
  assert.ok(!('publishedUtc' in marker))
  // Nothing published, so the copied source is still there — visibly incomplete, not "clean".
  assert.ok(readdirSync(join(prepared.runDir, 'work')).length > 0)
}

console.log('runtime-lifecycle-e2e: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/runtime-lifecycle-e2e.test.mjs`
Expected: FAIL until Tasks 1–3 are merged; PASS afterwards with no production change. If it
fails after those tasks, the failure is a real defect in them — fix the source, not the test.

- [ ] **Step 3: Write minimal implementation**

None. This task is verification only; if a case fails, fix the module it exercises.

- [ ] **Step 4: Run the full suite**

```bash
for t in tests/*/*.test.mjs; do echo "--- $t"; node "$t" || exit 1; done
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/secaudit/runtime-lifecycle-e2e.test.mjs
git commit -m "test(secaudit): end-to-end run lifecycle over awkward paths

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Out of scope for this plan

Run catalog, issue store, cross-run matching, and the dashboard. They are Parts 2 and 3:
`2026-09-10-secaudit-issue-store.md` and `2026-09-10-secaudit-workbench-dashboard.md`.

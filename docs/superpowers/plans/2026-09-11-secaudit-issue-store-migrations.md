# secaudit Issue Store Migration Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `.secaudit/issues.json` a versioned migration seam so a future shape change costs one function instead of costing every user their triage decisions, and use it to move audit-refuted findings out of the inbox in stores written before that rule existed.

**Architecture:** `STORE_VERSION` bumps 1 → 2. A `MIGRATIONS` map keyed by the version each migration upgrades *from* is applied by a pure `migrateStore(store)` that `readStore` calls after parsing. Migration happens in memory on every read; the migrated shape reaches disk the next time anything actually mutates the store, because `writeStore` stamps the current version. A read never writes.

**Tech Stack:** Node.js 22+, ESM `.mjs`, zero runtime dependencies. Tests are plain scripts using `node:assert`, run as `node tests/secaudit/<name>.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-10-secaudit-workbench-design.md` — specifically "the audit inbox holds observations requiring human triage" and the rule that human decisions are the only thing that moves a card.

**Context this plan assumes:** Parts 1–3 (`2026-09-10-secaudit-run-lifecycle.md`, `-issue-store.md`, `-workbench-dashboard.md`) are implemented and committed on this branch, including the change that opens audit-refuted findings in the archive with `suppressedBy: 'audit'`. This plan adds no board behaviour; it makes an existing rule reach stores that predate it.

## Global Constraints

- Node.js 22 or newer; no new runtime dependencies.
- `readStore` must remain read-only. The dashboard server reads on every request and two servers may be open against one project at once; a read that writes would bump `revision` and hand every open client a spurious `E_CONFLICT`.
- A migration must never overrule a human decision. `lastHumanUtc` is the proof a person made one.
- A migration must never invent a verdict. An issue whose evidence was not retained cannot be classified and stays exactly where it is.
- Migrations are pure functions of the store: no clock, no I/O, no randomness. Events they create carry `utc: null` rather than a fabricated timestamp.
- A store written by a *newer* secaudit than the running one is still a hard error. Old code cannot guess a future shape.

## File Structure

- `plugins/secaudit/skills/issues/scripts/issue-store.mjs` — gains `MIGRATIONS`, `migrateStore`, one migration function, and the version handling in `readStore`/`writeStore`. The store module already owns persistence and the transition table; the seam belongs with them, not in a new file, because a migration is a statement about the shapes this exact module produces.
- `tests/secaudit/issues-store-migration.test.mjs` — new. Kept out of `issues-store.test.mjs` because it tests the file format across versions rather than board behaviour, and it needs its own on-disk fixtures.
- `plugins/secaudit/README.md` — the upgrade note.

---

### Task 1: The migration seam and the v1 → v2 migration

**Files:**
- Modify: `plugins/secaudit/skills/issues/scripts/issue-store.mjs`
- Modify: `plugins/secaudit/README.md`
- Test: `tests/secaudit/issues-store-migration.test.mjs` (create)

**Interfaces:**
- Consumes: `classifyFinding` from `../../secaudit-generate-artifacts/scripts/report-contract.mjs` — `classifyFinding(finding)` returns `{bucket: 'confirmed'|'refuted'|'manual-review', manualKind}` and throws on a `DEFECT` with no trace verdict. `run-import.mjs` already imports from this module, so the dependency direction is established.
- Produces:
  - `STORE_VERSION === 2`
  - `migrateStore(store)` → a store at `STORE_VERSION`, pure; throws when no migration exists for a version below the current one.
  - `readStore(projectRoot)` → returns a migrated store; still never writes.
  - `writeStore(projectRoot, store)` → stamps `storeVersion: STORE_VERSION` alongside the revision bump.

**Why `lastHumanUtc` is the guard:** an issue sitting in `inbox` may have got there two ways — the audit put it there, or a human deliberately reopened a done issue. `lastHumanUtc` is set by `applyTransition` and only by `applyTransition`, so a non-null value means a person made a decision about this issue. The migration skips those. The audit's own verdict does not get to overrule a reviewer who already looked.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-store-migration.test.mjs
// The store is derived data except for human decisions — those are the one thing a run cannot
// rebuild. A migration exists so a shape change never costs them.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { STORE_VERSION, emptyStore, migrateStore, readStore, writeStore, storePath } =
  await import(join(scripts, 'issue-store.mjs'))

assert.equal(STORE_VERSION, 2)
assert.equal(emptyStore().storeVersion, 2)

// A v1 issue: the shape the store had before audit-refuted findings were archived.
const v1Issue = (over = {}) => ({
  id: 'iss_' + (over.id ?? 'a'.repeat(16)),
  class: 'idor', path: 'b.py', line: 2, title: 'Archive lookup exposure', severity: null,
  humanState: 'inbox', ambiguous: false,
  fingerprints: ['fp1:' + '2'.repeat(24)],
  observations: [{ runId: 'r1', observationId: 'o1', fingerprint: 'fp1:' + '2'.repeat(24) }],
  evidence: {
    o1: {
      observationId: 'o1', runId: 'r1', class: 'idor', path: 'b.py', line: 2,
      title: 'Archive lookup exposure', severity: null, challengeVerdict: 'DEFECT',
      challengeReason: 'reachable only from a removed route', traceVerdict: 'UNREACHABLE',
      traceEvidence: 'no route reaches it', impact: null, remediation: null, dynamicTest: null,
      fingerprint: 'fp1:' + '2'.repeat(24), fingerprintKind: 'anchor',
    },
  },
  firstSeenRunId: 'r1', lastSeenRunId: 'r1', lastHumanUtc: null,
  events: [{ utc: '2026-01-01T00:00:00Z', actor: 'system', type: 'observed', runId: 'r1' }],
  ...over,
})

const confirmedEvidence = {
  o1: {
    ...v1Issue().evidence.o1, severity: 'High', traceVerdict: 'REACHABLE',
    impact: 'Full order history read.', remediation: 'Check ownership.',
  },
}

const v1Store = {
  storeVersion: 1,
  revision: 7,
  importedRuns: [{ runId: 'r1', createdUtc: '2026-01-01T00:00:00Z', importedUtc: '2026-01-01T00:00:00Z', observationCount: 4 }],
  issues: [
    // Refuted, never touched by a person: this is the one the migration moves.
    v1Issue({ id: 'b'.repeat(16) }),
    // Refuted, but a human put it in the inbox on purpose. A migration must not overrule that.
    v1Issue({ id: 'c'.repeat(16), lastHumanUtc: '2026-02-01T00:00:00Z' }),
    // Not refuted: the audit wants this triaged.
    v1Issue({ id: 'd'.repeat(16), severity: 'High', evidence: confirmedEvidence }),
    // Evidence was never retained, so its verdict is unknowable. It stays put.
    v1Issue({ id: 'e'.repeat(16), evidence: undefined }),
  ],
}

const project = mkdtempSync(join(tmpdir(), 'secaudit migrate-'))
mkdirSync(join(project, '.secaudit'), { recursive: true })
const onDisk = storePath(project)
writeFileSync(onDisk, JSON.stringify(v1Store, null, 2) + '\n', 'utf8')
const bytesBefore = readFileSync(onDisk, 'utf8')

const migrated = await readStore(project)
assert.equal(migrated.storeVersion, 2)
const byId = Object.fromEntries(migrated.issues.map(i => [i.id, i]))

// Only the untouched refuted issue moves, and it is marked as the AUDIT's doing so it stays
// provisional: it is never published as suppressed, and a later non-refuting run frees it.
assert.equal(byId['iss_' + 'b'.repeat(16)].humanState, 'suppressed')
assert.equal(byId['iss_' + 'b'.repeat(16)].suppressedBy, 'audit')
const moved = byId['iss_' + 'b'.repeat(16)].events.at(-1)
assert.equal(moved.type, 'refuted-by-audit')
assert.equal(moved.utc, null, 'a migration must not fabricate a timestamp')

assert.equal(byId['iss_' + 'c'.repeat(16)].humanState, 'inbox', 'a human decision stands')
assert.equal(byId['iss_' + 'd'.repeat(16)].humanState, 'inbox')
assert.equal(byId['iss_' + 'e'.repeat(16)].humanState, 'inbox', 'no evidence, no verdict')

// Everything else survives the migration untouched.
assert.equal(migrated.revision, 7)
assert.deepEqual(migrated.importedRuns, v1Store.importedRuns)

// A read never writes. The server reads on every request; a writing read would bump the
// revision and hand every open client a spurious conflict.
assert.equal(readFileSync(onDisk, 'utf8'), bytesBefore)

// The migrated shape reaches disk on the next real write, which also stamps the version.
const written = await writeStore(project, migrated)
assert.equal(written.storeVersion, 2)
assert.equal(written.revision, 8)
assert.equal(JSON.parse(readFileSync(onDisk, 'utf8')).storeVersion, 2)

// migrateStore is pure and safe to apply to an already-current store.
assert.deepEqual(migrateStore(migrated), migrated)

// A store from a NEWER secaudit is still a hard error: old code cannot guess a future shape.
writeFileSync(onDisk, JSON.stringify({ ...v1Store, storeVersion: 99 }), 'utf8')
await assert.rejects(readStore(project), /newer secaudit/)

// So is a store with no usable version at all.
writeFileSync(onDisk, JSON.stringify({ ...v1Store, storeVersion: 'one' }), 'utf8')
await assert.rejects(readStore(project), /issue store version/)

console.log('issues-store-migration: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-store-migration.test.mjs`
Expected: FAIL — `STORE_VERSION` is 1, and `migrateStore` is not exported.

- [ ] **Step 3: Write the seam**

In `plugins/secaudit/skills/issues/scripts/issue-store.mjs`, add the import beside the existing ones:

```js
import { classifyFinding } from '../../secaudit-generate-artifacts/scripts/report-contract.mjs'
```

Replace `export const STORE_VERSION = 1` with:

```js
export const STORE_VERSION = 2
```

Add, directly above `readStore`:

```js
// v1 stores predate the rule that a finding the AUDIT refuted is archived rather than queued
// for triage, so they hold refuted findings in the inbox. Two guards keep this from doing harm:
// an issue a human has already decided about is never touched (lastHumanUtc is set by
// applyTransition and nothing else), and an issue whose evidence was not retained cannot be
// classified, so it stays exactly where it is rather than being guessed at.
function migrateV1ToV2(store) {
  return {
    ...store,
    issues: store.issues.map(issue => {
      if (issue.humanState !== 'inbox' || issue.lastHumanUtc) return issue
      const last = issue.observations[issue.observations.length - 1]
      const evidence = issue.evidence?.[last?.observationId]
      if (!evidence) return issue
      let bucket
      try {
        bucket = classifyFinding(evidence).bucket
      } catch {
        return issue                      // an unclassifiable record is not a refutation
      }
      if (bucket !== 'refuted') return issue
      return withEvent({ ...issue, humanState: 'suppressed', suppressedBy: 'audit' }, {
        utc: null, actor: 'system', type: 'refuted-by-audit',
        from: 'inbox', to: 'suppressed', migration: 'v1->v2',
      })
    }),
  }
}

// Keyed by the version each migration upgrades FROM. Applied in order, in memory, on every
// read; the result reaches disk the next time something actually mutates the store. Adding a
// shape change means bumping STORE_VERSION and adding one entry here — not writing a new
// shape-sniffing heuristic, and never asking anyone to delete their board.
const MIGRATIONS = new Map([[1, migrateV1ToV2]])

export function migrateStore(store) {
  let current = store
  while (current.storeVersion < STORE_VERSION) {
    const migrate = MIGRATIONS.get(current.storeVersion)
    if (!migrate) {
      throw new Error('no migration from issue store version ' + current.storeVersion)
    }
    current = { ...migrate(current), storeVersion: current.storeVersion + 1 }
  }
  return current
}
```

Replace the body of `readStore` after the `JSON.parse` with:

```js
  const parsed = JSON.parse(raw)
  const version = parsed?.storeVersion
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('unsupported issue store version: ' + version)
  }
  if (version > STORE_VERSION) {
    throw new Error('issue store version ' + version + ' was written by a newer secaudit; '
      + 'upgrade the plugin rather than downgrading the store')
  }
  return migrateStore(parsed)
```

And in `writeStore`, stamp the version alongside the revision bump:

```js
  const next = { ...store, storeVersion: STORE_VERSION, revision: store.revision + 1 }
```

- [ ] **Step 4: Run the new test and the whole suite**

Run:

```bash
node tests/secaudit/issues-store-migration.test.mjs
for t in tests/*/*.test.mjs; do node "$t" >/dev/null || echo "FAIL $t"; done
```

Expected: `issues-store-migration: ok`, and no `FAIL` lines.

`tests/secaudit/issues-store.test.mjs` and `tests/secaudit/issues-http-routes.test.mjs` build
their stores through `emptyStore()`, so they follow the bump automatically. If any test asserts
`storeVersion` is 1 or writes a store literal with `storeVersion: 1`, update the expectation to
2 — that is the change under test, not a regression.

- [ ] **Step 5: Document the upgrade**

In `plugins/secaudit/README.md`, in the `## The Workbench` section, after the paragraph that
begins "Decisions live in `<project-root>/.secaudit/issues.json`", add:

```markdown
Upgrading secaudit never asks you to re-run an audit or delete your board. The store carries a
version, and a newer plugin migrates an older store in memory as it reads it, writing the new
shape back the next time you actually change something. Migrations never overrule a decision a
person made, and never invent a verdict for a finding whose evidence was not retained. Old run
directories import as they always did: pre-anchor findings get a `legacy1:` identity and are
flagged for an explicit merge decision rather than being guessed into an existing issue.
Downgrading is the one direction that does not work — an older plugin refuses a store newer
than it understands, rather than silently discarding the fields it does not know about.
```

- [ ] **Step 6: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/issue-store.mjs \
        tests/secaudit/issues-store-migration.test.mjs plugins/secaudit/README.md
git commit -m "feat(secaudit): versioned migration seam for the issue store

An upgrade must never cost a reviewer their triage decisions, which are the one thing a run
cannot rebuild. readStore now migrates an older store in memory and writeStore stamps the
current version, so a read stays read-only while the new shape reaches disk on the next real
change. The first migration archives findings the audit refuted in stores written before that
rule existed, skipping any issue a human had already decided about.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Out of scope

No migration CLI, no downgrade path, no backfill of `bucket` onto stored observations, and no
change to how runs are imported or how the board behaves. Run directories keep their own
independent `formatVersion`; this plan does not touch it.

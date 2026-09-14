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
// `id` is derived from `over.id` and so must be applied AFTER the spread, or an override
// replaces the whole identifier instead of its suffix.
const v1Issue = (over = {}) => ({
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
  id: 'iss_' + (over.id ?? 'a'.repeat(16)),
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

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
// The full observation is kept alongside the reference, so the detail view survives the run
// directory being pruned.
assert.equal(store.issues[0].evidence[store.issues[0].observations[0].observationId].title,
  'SQL injection')

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

// A finding the audit refuted opens in the archive, marked as the AUDIT's doing. It needs no
// human triage, so it must never occupy the inbox.
let audit = ingestRun(emptyStore(), run('r1', '2026-01-01T00:00:00Z', [obs({
  observationId: 'idor@b.py:2@refuted', class: 'idor', path: 'b.py', line: 2,
  title: 'Archive lookup exposure', severity: null, traceVerdict: 'UNREACHABLE',
  bucket: 'refuted', fingerprint: 'fp1:' + '2'.repeat(24),
})]))
assert.equal(audit.outcomes[0].outcome, 'refuted')
assert.equal(audit.store.issues[0].humanState, 'suppressed')
assert.equal(audit.store.issues[0].suppressedBy, 'audit')

// An audit refutation is provisional: a later run that stops refuting the same defect returns
// it to the inbox. Anything else buries a real finding behind a verdict the audit withdrew.
const unrefuted = ingestRun(audit.store, run('r2', '2026-02-01T00:00:00Z', [obs({
  observationId: 'idor@b.py:2@reachable', class: 'idor', path: 'b.py', line: 2, runId: 'r2',
  title: 'Archive lookup exposure', severity: 'High', traceVerdict: 'REACHABLE',
  bucket: 'confirmed', fingerprint: 'fp1:' + '2'.repeat(24),
})]))
assert.equal(unrefuted.outcomes[0].outcome, 'unrefuted')
assert.equal(unrefuted.store.issues[0].humanState, 'inbox')
assert.equal(unrefuted.store.issues[0].suppressedBy, null)

// A HUMAN dismissal is absolute by contrast: the same re-observation leaves it archived.
let dismissed = applyTransition(audit.store, { issueId: audit.store.issues[0].id,
  action: 'restore', revision: audit.store.revision, utc: '2026-01-05T00:00:00Z' }).store
dismissed = applyTransition(dismissed, { issueId: dismissed.issues[0].id,
  action: 'false-positive', revision: dismissed.revision, utc: '2026-01-06T00:00:00Z' }).store
assert.equal(dismissed.issues[0].suppressedBy, 'human')
const stillDismissed = ingestRun(dismissed, run('r3', '2026-03-01T00:00:00Z', [obs({
  observationId: 'idor@b.py:2@reachable2', class: 'idor', path: 'b.py', line: 2, runId: 'r3',
  title: 'Archive lookup exposure', severity: 'High', traceVerdict: 'REACHABLE',
  bucket: 'confirmed', fingerprint: 'fp1:' + '2'.repeat(24),
})]))
assert.equal(stillDismissed.outcomes[0].outcome, 'suppressed')
assert.equal(stillDismissed.store.issues[0].humanState, 'suppressed')

console.log('issues-store audit refutation: ok')

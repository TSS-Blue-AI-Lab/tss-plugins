import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { emptyStore, ingestRun, applyTransition } = await import(join(scripts, 'issue-store.mjs'))
const { boardView, archiveView, detailView, runsView, runDetailView } =
  await import(join(scripts, 'view-model.mjs'))

const observation = (over = {}) => ({
  observationId: 'o1', runId: 'r1', class: 'sqli', path: 'a.py', line: 4,
  title: 'SQL injection in get_order', severity: 'High', challengeVerdict: 'DEFECT',
  challengeReason: 'String concatenation reaches the driver.', traceVerdict: 'REACHABLE',
  traceEvidence: 'POST /orders to handler', impact: 'Full table read.',
  remediation: 'Use a parameterized query.', dynamicTest: null,
  fingerprint: 'fp1:' + '1'.repeat(24), fingerprintKind: 'anchor', ...over,
})

let store = ingestRun(emptyStore(), {
  runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok', observations: [observation()],
}).store

const board = boardView(store)
assert.equal(board.columns.inbox.length, 1)
assert.equal(board.columns.confirmed.length, 0)
assert.equal(board.columns.done.length, 0)
assert.equal(board.revision, store.revision)
// Only the moves the store will accept are offered.
assert.deepEqual(board.columns.inbox[0].allowedActions.sort(), ['confirm', 'false-positive'])

const id = store.issues[0].id
const detail = detailView(store, id)
const keys = detail.sections.map(s => s.key)
assert.deepEqual(keys, ['location', 'challenge', 'trace', 'impact', 'remediation'])
// Absent optional sections are omitted, never invented, and present text is verbatim.
assert.ok(!keys.includes('dynamicTest'))
assert.equal(detail.sections.find(s => s.key === 'remediation').text,
  'Use a parameterized query.')
// The audit verdict stays visible and separate from human state.
assert.equal(detail.issue.humanState, 'inbox')
assert.equal(detail.issue.latestObservation.challengeVerdict, 'DEFECT')

// A dynamic test appears only when the record carries one.
const withTest = ingestRun(emptyStore(), {
  runId: 'r9', runDir: '/x/r9', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok',
  observations: [observation({ dynamicTest: 'GET /orders/999 as another account' })],
}).store
assert.ok(detailView(withTest, withTest.issues[0].id).sections.some(s => s.key === 'dynamicTest'))

// Suppressed issues leave the board for the archive and keep their evidence.
store = applyTransition(store, { issueId: id, action: 'false-positive',
  revision: store.revision, utc: '2026-01-02T00:00:00Z' }).store
assert.equal(boardView(store).columns.inbox.length, 0)
assert.equal(boardView(store).archivedCount, 1)
const archived = archiveView(store)
assert.equal(archived.cards.length, 1)
assert.deepEqual(archived.cards[0].allowedActions, ['restore'])

// Runs merge discovery with import state so an unavailable run is visible, with its reason.
const runs = runsView(store, [
  { runId: 'r1', runDir: '/x/r1' },
  { runId: 'r2', runDir: '/x/r2', status: 'unavailable', reason: 'no report-data.json' },
])
assert.equal(runs.runs.length, 2)
assert.equal(runs.runs.find(r => r.runId === 'r2').status, 'unavailable')
assert.match(runs.runs.find(r => r.runId === 'r2').reason, /report-data/)

console.log('issues-view-model: ok')

// A run's record leads with the worst thing that run found. Unrated findings — refuted, or
// awaiting a defect determination — sort last: the audit did not rate them, which is not the
// same as rating them harmless.
{
  const at = (over) => observation({ ...over, fingerprint: 'fp1:' + over.observationId.padEnd(24, '0') })
  const runStore = ingestRun(emptyStore(), {
    runId: 'r5', runDir: '/x/r5', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
    status: 'ok',
    observations: [
      at({ observationId: 'med', runId: 'r5', severity: 'Medium', path: 'm.py', line: 1 }),
      at({ observationId: 'none', runId: 'r5', severity: null, path: 'n.py', line: 1,
        challengeVerdict: 'UNSURE', traceVerdict: null }),
      at({ observationId: 'crit', runId: 'r5', severity: 'Critical', path: 'c.py', line: 1 }),
      at({ observationId: 'high2', runId: 'r5', severity: 'High', path: 'b.py', line: 9 }),
      at({ observationId: 'high1', runId: 'r5', severity: 'High', path: 'b.py', line: 2 }),
    ],
  }).store
  const detail = runDetailView(runStore, 'r5')
  assert.deepEqual(detail.cards.map(c => c.severity), ['Critical', 'High', 'High', 'Medium', null])
  // Ties break on path then line, so two reads of the same run never disagree.
  assert.deepEqual(detail.cards.filter(c => c.severity === 'High').map(c => c.line), [2, 9])
  assert.equal(detail.facts.observations, 5)
  console.log('issues-view-model run ordering: ok')
}

// The runs list reads newest first: the run someone wants is nearly always the last one.
{
  const seen = ingestRun(emptyStore(), {
    runId: '20260301T000000Z-cccccccc', runDir: '/x/c', createdUtc: '2026-03-01T00:00:00Z',
    target: '/p', scope: [], status: 'ok', observations: [observation({ runId: '20260301T000000Z-cccccccc' })],
  }).store
  const listed = runsView(seen, [
    { runId: '20260101T000000Z-aaaaaaaa', runDir: '/x/a' },
    { runId: '20260301T000000Z-cccccccc', runDir: '/x/c' },
    { runId: '20260201T000000Z-bbbbbbbb', runDir: '/x/b', status: 'unavailable', reason: 'no report-data.json' },
  ]).runs
  assert.deepEqual(listed.map(r => r.runId), [
    '20260301T000000Z-cccccccc',
    '20260201T000000Z-bbbbbbbb',
    '20260101T000000Z-aaaaaaaa',
  ])
  // A run that was never imported has no createdUtc and still sorts correctly: the order comes
  // from the run id, which begins with its own UTC timestamp.
  assert.equal(listed[1].createdUtc, null)
  console.log('issues-view-model run listing: ok')
}

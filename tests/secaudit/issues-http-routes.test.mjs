// tests/secaudit/issues-http-routes.test.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { emptyStore, ingestRun, readStore, writeStore } =
  await import(join(scripts, 'issue-store.mjs'))
const { handleRequest } = await import(join(scripts, 'http-routes.mjs'))

const projectRoot = mkdtempSync(join(tmpdir(), 'secaudit routes-'))
const origin = 'http://127.0.0.1:7777'

const seeded = ingestRun(emptyStore(), {
  runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok',
  observations: [{
    observationId: 'o1', runId: 'r1', class: 'sqli', path: 'a.py', line: 4, title: 'SQLi',
    severity: 'High', challengeVerdict: 'DEFECT', challengeReason: 'concat',
    traceVerdict: 'REACHABLE', traceEvidence: 'route', impact: 'i', remediation: 'r',
    dynamicTest: null, fingerprint: 'fp1:' + '1'.repeat(24), fingerprintKind: 'anchor',
  }],
}).store
await writeStore(projectRoot, seeded)

const call = (method, url, { body, headers = {} } = {}) => handleRequest({
  method, url, headers: { origin, ...headers }, body, projectRoot, origin,
  now: '2026-02-01T00:00:00Z',
})

// Board read.
const board = await call('GET', '/api/board')
assert.equal(board.status, 200)
const boardBody = JSON.parse(board.body)
assert.equal(boardBody.ok, true)
assert.equal(boardBody.data.columns.inbox.length, 1)

const id = boardBody.data.columns.inbox[0].id
const revision = boardBody.data.revision

// A GET may not mutate.
assert.equal((await call('GET', `/api/issues/${id}/transition`)).status, 405)

// Foreign origins are refused outright.
const foreign = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'confirm', revision }),
  headers: { origin: 'http://evil.example' },
})
assert.equal(foreign.status, 403)
assert.equal(JSON.parse(foreign.body).error.code, 'E_ORIGIN')

// A stale revision is a conflict, and the response hands back the current board so the client
// can refresh rather than overwrite a newer decision.
const stale = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'confirm', revision: revision - 1 }),
})
assert.equal(stale.status, 409)
const staleBody = JSON.parse(stale.body)
assert.equal(staleBody.error.code, 'E_CONFLICT')
assert.equal(staleBody.error.currentRevision, (await readStore(projectRoot)).revision)

// An illegal move is refused without touching the store.
const illegal = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'done', revision }),
})
assert.equal(illegal.status, 422)
assert.equal((await readStore(projectRoot)).issues[0].humanState, 'inbox')

// The legal move persists and returns the new revision.
const ok = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'confirm', revision }),
})
assert.equal(ok.status, 200)
const persisted = await readStore(projectRoot)
assert.equal(persisted.issues[0].humanState, 'confirmed')
assert.equal(JSON.parse(ok.body).data.revision, persisted.revision)

// Unknown issue and unknown route.
assert.equal((await call('GET', '/api/issues/iss_nope')).status, 404)
assert.equal((await call('GET', '/api/nothing')).status, 404)

console.log('issues-http-routes: ok')

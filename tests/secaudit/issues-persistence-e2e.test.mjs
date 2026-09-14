// tests/secaudit/issues-persistence-e2e.test.mjs
// The claim this whole feature rests on: a decision made in the browser is still there after
// the server dies. Anything less and the board is a pretty view of nothing.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const scripts = join(here, '..', '..', 'plugins', 'secaudit', 'skills', 'issues', 'scripts')
// Windows: an absolute path is not a valid ESM specifier, so dynamic import takes a URL.
const script = name => import(pathToFileURL(join(scripts, name)).href)
const { startServer } = await script('server.mjs')
const { syncProject } = await script('sync.mjs')
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'report-data.json'), 'utf8'))

const project = mkdtempSync(join(tmpdir(), 'secaudit e2e board-'))
const runDir = join(project, '.secaudit', 'runs', '20260101T000000Z-aaaaaaaa')
mkdirSync(join(runDir, 'work', 'sast'), { recursive: true })
writeFileSync(join(runDir, 'work', 'sast', 'report-data.json'), JSON.stringify({
  ...fixture,
  findings: [{
    ...fixture.findings[0],
    anchor: { version: 1, anchorKind: 'decl', anchorName: 'h',
      codeHash: '1'.repeat(16), fingerprint: 'fp1:' + '1'.repeat(24) },
  }],
}), 'utf8')
writeFileSync(join(runDir, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 2, runId: '20260101T000000Z-aaaaaaaa',
  target: project, state: 'complete', createdUtc: '2026-01-01T00:00:00Z', scope: [],
}), 'utf8')

await syncProject(project)

let server = await startServer({ projectRoot: project, port: 0 })
let board = (await (await fetch(server.url + '/api/board')).json()).data
const id = board.columns.inbox[0].id

const move = async (action, revision) => (await (await fetch(
  `${server.url}/api/issues/${id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url },
    body: JSON.stringify({ action, revision }),
  })).json())

let result = await move('confirm', board.revision)
assert.equal(result.ok, true)
result = await move('done', result.data.revision)
assert.equal(result.data.board.columns.done.length, 1)
await server.close()

// Restart: the decision survived the process.
server = await startServer({ projectRoot: project, port: 0 })
board = (await (await fetch(server.url + '/api/board')).json()).data
assert.equal(board.columns.done.length, 1)
assert.equal(board.columns.inbox.length, 0)

// A repeat observation of a done issue reopens it into Confirmed, not into the inbox.
// A run only reopens a done issue if it STARTED after the human marked it done, and the human
// move above was stamped with the server's own clock — so this run is dated after that, not at
// a fixed past date.
const secondRunUtc = new Date(Date.now() + 86400000).toISOString()
const secondRun = join(project, '.secaudit', 'runs', '20260201T000000Z-bbbbbbbb')
mkdirSync(join(secondRun, 'work', 'sast'), { recursive: true })
writeFileSync(join(secondRun, 'work', 'sast', 'report-data.json'),
  readFileSync(join(runDir, 'work', 'sast', 'report-data.json'), 'utf8'), 'utf8')
writeFileSync(join(secondRun, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 2, runId: '20260201T000000Z-bbbbbbbb',
  target: project, state: 'complete', createdUtc: secondRunUtc, scope: [],
}), 'utf8')

const synced = await (await fetch(server.url + '/api/sync', {
  method: 'POST', headers: { origin: server.url },
})).json()
assert.equal(synced.data.summary.reopened, 1)
assert.equal(synced.data.board.columns.confirmed.length, 1)
assert.equal(synced.data.board.columns.inbox.length, 0)

await server.close()
console.log('issues-persistence-e2e: ok')

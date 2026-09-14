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
assert.deepEqual(second.summary,
  { new: 0, repeat: 0, reopened: 0, suppressed: 0, ambiguous: 0, refuted: 0, unrefuted: 0 })
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

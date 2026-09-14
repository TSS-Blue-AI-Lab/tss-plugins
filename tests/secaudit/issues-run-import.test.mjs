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

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

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

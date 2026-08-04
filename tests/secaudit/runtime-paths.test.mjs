import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import {
  resolveTarget, findGitToplevel, makeRunId, selectRunDir,
  writeMarker, readMarker,
} from '../../plugins/secaudit/skills/run/scripts/run-paths.mjs'

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-paths-')))

// resolveTarget: relative input resolves against the given cwd, canonicalized.
mkdirSync(join(base, 'repo', 'src'), { recursive: true })
assert.strictEqual(await resolveTarget('repo', base), join(base, 'repo'))

// Missing / non-directory targets → stable error codes.
await assert.rejects(resolveTarget('nope', base), err => err.code === 'E_TARGET_MISSING')
writeFileSync(join(base, 'afile'), '', 'utf8')
await assert.rejects(resolveTarget('afile', base), err => err.code === 'E_TARGET_NOT_DIRECTORY')

// Omitted input: git toplevel above cwd wins (review decision 5)…
mkdirSync(join(base, 'repo', '.git'))
assert.strictEqual(findGitToplevel(join(base, 'repo', 'src')), join(base, 'repo'))
assert.strictEqual(await resolveTarget(undefined, join(base, 'repo', 'src')), join(base, 'repo'))
// …else cwd (self-consistent guard in case an ancestor of tmpdir has a .git).
const plainSub = join(base, 'plain', 'sub')
mkdirSync(plainSub, { recursive: true })
assert.strictEqual(
  await resolveTarget(undefined, plainSub),
  findGitToplevel(plainSub) ?? plainSub,
)

// makeRunId: UTC timestamp + hash8, collision suffix.
const id = makeRunId('2026-07-30T10:15:00.123Z', 'deadbeef', () => false)
assert.strictEqual(id, '20260730T101500Z-deadbeef')
const bumped = makeRunId('2026-07-30T10:15:00.123Z', 'deadbeef',
  seen => seen === '20260730T101500Z-deadbeef')
assert.strictEqual(bumped, '20260730T101500Z-deadbeef-2')

// selectRunDir: default lands under <target>/.secaudit/runs/<runId>.
const target = join(base, 'repo')
const picked = await selectRunDir(target, null, id)
assert.deepStrictEqual(picked, {
  runDir: join(target, '.secaudit', 'runs', id), insideTarget: true, isDefault: true,
})

// Rejections, each with its stable code.
await assert.rejects(selectRunDir(target, target, id), err => err.code === 'E_OUTPUT_IS_TARGET')
await assert.rejects(selectRunDir(target, base, id), err => err.code === 'E_OUTPUT_CONTAINS_TARGET')
const unowned = join(base, 'unowned')
mkdirSync(unowned)
writeFileSync(join(unowned, 'f'), '', 'utf8')
await assert.rejects(selectRunDir(target, unowned, id), err => err.code === 'E_OUTPUT_NOT_EMPTY_UNOWNED')
const owned = join(base, 'owned')
mkdirSync(owned)
await writeMarker(owned, { runId: 'old-run', target, createdUtc: 'x', state: 'prepared' })
await assert.rejects(selectRunDir(target, owned, id), err => err.code === 'E_OUTPUT_RUN_EXISTS')

// A fresh, not-yet-existing nested path outside the target is accepted.
const fresh = await selectRunDir(target, join(base, 'new', 'run'), id)
assert.strictEqual(fresh.runDir, join(base, 'new', 'run'))
assert.strictEqual(fresh.insideTarget, false)
assert.strictEqual(fresh.isDefault, false)

// Marker roundtrip; non-marker JSON is not treated as ownership.
assert.strictEqual((await readMarker(owned)).runId, 'old-run')
writeFileSync(join(unowned, 'secaudit-run.json'), '{"marker":"other"}', 'utf8')
assert.strictEqual(await readMarker(unowned), null)

// Symlink aliasing: an output path routed through a symlink to the target is caught.
try {
  symlinkSync(target, join(base, 'alias'))
  await assert.rejects(selectRunDir(target, join(base, 'alias'), id),
    err => err.code === 'E_OUTPUT_IS_TARGET')
} catch (err) {
  if (err.code !== 'EPERM') throw err
}

console.log('PASS runtime-paths')

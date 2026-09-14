import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, realpathSync,
} from 'node:fs'
import { mkdtemp, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import {
  enumerateSource, measureSource, hashSource,
} from '../../plugins/secaudit/skills/run/scripts/source-corpus.mjs'

// Space in the directory name on purpose — paths with spaces are a required test case.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit corpus-')))
writeFileSync(join(root, 'app.py'), 'x', 'utf8') // 1 byte, 1 line
mkdirSync(join(root, 'src'))
writeFileSync(join(root, 'src', 'ünïcode.cs'), 'a\nbc', 'utf8') // 4 bytes, 2 lines
writeFileSync(join(root, 'notes.txt'), 'not source, still hashed', 'utf8')
for (const dir of ['node_modules', 'dist', '.venv', '.secaudit']) {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, 'x.js'), 'ignored', 'utf8')
}

const { files, excludedDirsHit } = await enumerateSource(root)
assert.deepStrictEqual(files, ['app.py', 'notes.txt', 'src/ünïcode.cs'])
assert.deepStrictEqual(excludedDirsHit, ['.secaudit', '.venv', 'dist', 'node_modules'])

const coverage = await measureSource(root, files)
assert.deepStrictEqual(coverage, {
  sourceFiles: 2, sourceLines: 3, sourceBytes: 5, estimatedSourceTokens: 2,
})

const before = await hashSource(root, files)
assert.match(before, /^[0-9a-f]{64}$/)

// Review decision 4: dependency/build churn must NOT move the corpus hash.
writeFileSync(join(root, 'node_modules', 'installed-mid-run.js'), 'x', 'utf8')
const after = await hashSource(root, (await enumerateSource(root)).files)
assert.strictEqual(after, before, 'excluded-dir churn must not change the corpus hash')

// A source edit MUST move it.
writeFileSync(join(root, 'app.py'), 'y', 'utf8')
assert.notStrictEqual(await hashSource(root, files), before)

// A non-source-file edit MUST also move it (publication gate must see config/SQL/template
// tampering, not just SOURCE_EXTENSIONS churn).
const beforeNotes = await hashSource(root, files)
writeFileSync(join(root, 'notes.txt'), 'tampered', 'utf8')
const afterNotes = await hashSource(root, files)
assert.notStrictEqual(afterNotes, beforeNotes,
  'corpus hash must cover non-source files (publication gate must see config/SQL/template tampering)')

// extraExcluded prunes a subtree (an explicit --output inside the target).
mkdirSync(join(root, 'reports'))
writeFileSync(join(root, 'reports', 'r.md'), 'out', 'utf8')
const pruned = await enumerateSource(root, { extraExcluded: [join(root, 'reports')] })
assert.ok(!pruned.files.includes('reports/r.md'), 'extraExcluded subtree must be pruned')

// Symlinks: internal recorded and NOT hashed/enumerated as files; external recorded.
let symlinksSupported = true
try {
  symlinkSync(join(root, 'app.py'), join(root, 'link-internal.py'))
  symlinkSync(tmpdir(), join(root, 'link-external'))
  const withLinks = await enumerateSource(root)
  assert.deepStrictEqual(withLinks.internalSymlinks, ['link-internal.py'])
  assert.deepStrictEqual(withLinks.externalSymlinks, ['link-external'])
  assert.ok(!withLinks.files.includes('link-internal.py'))
} catch (err) {
  if (err.code !== 'EPERM') throw err // some hosts forbid symlink creation
  symlinksSupported = false
}

// The pristine gate must see symlink tampering: add / remove / retarget each move the hash.
if (symlinksSupported) {
  const linkRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'corpus-links-')))
  mkdirSync(join(linkRoot, 'src'))
  writeFileSync(join(linkRoot, 'src', 'a.py'), 'a\n', 'utf8')
  writeFileSync(join(linkRoot, 'src', 'b.py'), 'b\n', 'utf8')

  const hashOf = async dir => {
    const e = await enumerateSource(dir)
    return hashSource(dir, e.files, [...e.internalSymlinks, ...e.externalSymlinks])
  }
  const noLink = await hashOf(linkRoot)

  symlinkSync('a.py', join(linkRoot, 'src', 'link.py'))
  const addedLink = await hashOf(linkRoot)
  assert.notStrictEqual(addedLink, noLink, 'adding a symlink must move the corpus hash')

  unlinkSync(join(linkRoot, 'src', 'link.py'))
  symlinkSync('b.py', join(linkRoot, 'src', 'link.py'))
  const retargeted = await hashOf(linkRoot)
  assert.notStrictEqual(retargeted, addedLink, 'retargeting a symlink must move the corpus hash')

  unlinkSync(join(linkRoot, 'src', 'link.py'))
  assert.strictEqual(await hashOf(linkRoot), noLink, 'removing the symlink restores the hash')
  assert.notStrictEqual(noLink, retargeted, 'removing a symlink must move the corpus hash')

  // An external (even dangling) symlink is hashed too — retargeting it must not be invisible.
  symlinkSync('/nowhere/one', join(linkRoot, 'src', 'ext.py'))
  const ext1 = await hashOf(linkRoot)
  unlinkSync(join(linkRoot, 'src', 'ext.py'))
  symlinkSync('/nowhere/two', join(linkRoot, 'src', 'ext.py'))
  assert.notStrictEqual(await hashOf(linkRoot), ext1,
    'retargeting an external symlink must move the corpus hash')

  // A symlink must never collide with a regular file of the same path and content.
  const fileRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'corpus-file-')))
  writeFileSync(join(fileRoot, 'x'), 'y', 'utf8')
  const linkOnly = realpathSync.native(mkdtempSync(join(tmpdir(), 'corpus-link-')))
  symlinkSync('y', join(linkOnly, 'x'))
  assert.notStrictEqual(await hashOf(linkOnly), await hashOf(fileRoot),
    'a symlink and a file with the same path/content must hash differently')
}

// An UNDECLARED secaudit run marker directory is an anomaly, reported so callers can refuse;
// a DECLARED one (extraExcluded) is pruned before the marker check and never reported.
{
  const markerRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'corpus-marker-')))
  writeFileSync(join(markerRoot, 'top.py'), 'top\n', 'utf8')
  mkdirSync(join(markerRoot, 'hidden'))
  writeFileSync(join(markerRoot, 'hidden', 'evil.py'), 'evil\n', 'utf8')
  writeFileSync(join(markerRoot, 'hidden', 'secaudit-run.json'),
    JSON.stringify({ marker: 'secaudit-run', formatVersion: 1 }), 'utf8')

  const undeclared = await enumerateSource(markerRoot)
  assert.deepStrictEqual(undeclared.excludedRunDirs, ['hidden'])
  assert.ok(!undeclared.files.includes('hidden/evil.py'), 'marker dir is pruned from the walk')

  const declared = await enumerateSource(markerRoot, { extraExcluded: [join(markerRoot, 'hidden')] })
  assert.deepStrictEqual(declared.excludedRunDirs, [],
    'a declared exclusion is pruned before the marker check, so it is never an anomaly')
}

// Framing ambiguity: {f:"x\0y"} vs {f:"x", y:""} collide under `rel NUL content NUL`.
{
  const a = await mkdtemp(join(tmpdir(), 'corpus-a-'))
  const b = await mkdtemp(join(tmpdir(), 'corpus-b-'))
  await writeFile(join(a, 'f'), Buffer.from('x\0y', 'binary'))
  await writeFile(join(b, 'f'), 'x')
  await writeFile(join(b, 'y'), '')
  const hashA = await hashSource(await realpath(a), ['f'])
  const hashB = await hashSource(await realpath(b), ['f', 'y'])
  assert.notStrictEqual(hashA, hashB, 'length-prefixed framing must distinguish NUL-in-content trees')
}

console.log('PASS runtime-source-corpus')

// --- scope selection -------------------------------------------------------
{
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit scope-')))
  mkdirSync(join(root, 'api', 'deep'), { recursive: true })
  mkdirSync(join(root, 'web'), { recursive: true })
  writeFileSync(join(root, 'api', 'a.py'), 'a = 1\n', 'utf8')
  writeFileSync(join(root, 'api', 'deep', 'b.py'), 'b = 1\n', 'utf8')
  writeFileSync(join(root, 'web', 'c.js'), 'c\n', 'utf8')
  writeFileSync(join(root, 'root.py'), 'r = 1\n', 'utf8')

  const all = await enumerateSource(root)
  assert.deepEqual(all.files, ['api/a.py', 'api/deep/b.py', 'root.py', 'web/c.js'])
  assert.deepEqual(all.scope, [])

  const scoped = await enumerateSource(root, { scope: ['api'] })
  assert.deepEqual(scoped.files, ['api/a.py', 'api/deep/b.py'])
  assert.deepEqual(scoped.scope, ['api'])
  assert.deepEqual(scoped.scopeMisses, [])

  // A single file is a valid scope entry.
  const oneFile = await enumerateSource(root, { scope: ['root.py'] })
  assert.deepEqual(oneFile.files, ['root.py'])

  // Nonexistent scope entries are reported, not silently ignored.
  const missing = await enumerateSource(root, { scope: ['api', 'nope'] })
  assert.deepEqual(missing.scopeMisses, ['nope'])

  // Scope never escapes the root.
  await assert.rejects(enumerateSource(root, { scope: ['../elsewhere'] }),
    err => /scope entry escapes the target/.test(err.message))

  console.log('source-corpus scope: ok')
}

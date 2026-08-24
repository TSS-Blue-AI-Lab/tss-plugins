// tests/runtime-prepare.test.mjs
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, symlinkSync,
  readdirSync, readlinkSync, lstatSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const cli = join(repoRoot, 'skills/run/scripts/secaudit-runtime.mjs')
const gitEnv = ['-c', 'user.email=t@t', '-c', 'user.name=t']

const target = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit prepare-'))) // space on purpose
writeFileSync(join(target, 'app.py'), 'print(1)\n', 'utf8')
mkdirSync(join(target, 'src'))
writeFileSync(join(target, 'src', 'lib.py'), 'x = 1\n', 'utf8')
mkdirSync(join(target, 'node_modules'))
writeFileSync(join(target, 'node_modules', 'dep.js'), 'x', 'utf8')

// Every prepare below pins an explicit cwd. The default run directory follows the PROJECT root,
// which falls back to the repository the process is standing in when the target is not itself in
// one — without a pinned cwd these spawns would write their run directories into this checkout.

// A clean git target must stay clean after a default-output prepare.
execFileSync('git', ['init', '-q'], { cwd: target })
execFileSync('git', [...gitEnv, 'add', '-A'], { cwd: target })
execFileSync('git', [...gitEnv, 'commit', '-qm', 'init'], { cwd: target })

const prep = JSON.parse(
  execFileSync('node', [cli, 'prepare', '--target', target], { cwd: target }).toString('utf8'))
assert.match(prep.runId, /^\d{8}T\d{6}Z-[0-9a-f]{8}(-\d+)?$/)
assert.strictEqual(prep.runId.slice(17, 25), prep.corpusSha256.slice(0, 8))
assert.strictEqual(prep.runDir, join(target, '.secaudit', 'runs', prep.runId))
assert.strictEqual(prep.work, join(prep.runDir, 'work'))
assert.match(prep.corpusSha256, /^[0-9a-f]{64}$/)
assert.match(prep.generatedDate, /^\d{4}-\d{2}-\d{2}$/)

// Isolated copy: complete for source, absent for exclusions.
assert.ok(existsSync(join(prep.work, 'app.py')))
assert.ok(existsSync(join(prep.work, 'src', 'lib.py')))
assert.ok(!existsSync(join(prep.work, 'node_modules')))
assert.strictEqual(readFileSync(join(prep.work, 'app.py'), 'utf8'), 'print(1)\n')

// Ownership marker: valid, prepared, hash recorded.
const marker = JSON.parse(readFileSync(join(prep.runDir, 'secaudit-run.json'), 'utf8'))
assert.strictEqual(marker.marker, 'secaudit-run')
assert.strictEqual(marker.formatVersion, 1)
assert.strictEqual(marker.runId, prep.runId)
assert.strictEqual(marker.state, 'prepared')
assert.strictEqual(marker.corpusSha256, prep.corpusSha256)

// insideTarget: default output lands inside the target, and the marker says so.
assert.strictEqual(prep.insideTarget, true)
assert.strictEqual(marker.insideTarget, true)

// The target is its own repository root, so the project root IS the target: unchanged layout.
assert.strictEqual(prep.artifactRoot, target)
assert.strictEqual(prep.artifactRootSource, 'targetGitRoot')
assert.strictEqual(marker.artifactRoot, target)

// The run directory ignores its own contents: clean target stays clean.
assert.strictEqual(readFileSync(join(prep.runDir, '.gitignore'), 'utf8'), '*\n')
assert.strictEqual(
  execFileSync('git', ['status', '--porcelain'], { cwd: target }).toString('utf8'),
  '', 'default-output prepare must not dirty a clean target')

// Re-prepare: new run-id, identical corpus hash (prepare must not mutate the source).
// Also the no-false-positive case for the run-marker guard: run 1's marker directory is
// sitting inside the target, but under `.secaudit` it is a declared exclusion, not an anomaly.
const prep2 = JSON.parse(
  execFileSync('node', [cli, 'prepare', '--target', target], { cwd: target }).toString('utf8'))
assert.notStrictEqual(prep2.runId, prep.runId)
assert.strictEqual(prep2.corpusSha256, prep.corpusSha256)
assert.deepStrictEqual(prep2.excludedRunDirs, [])

// Explicit --output outside the target: no .secaudit is created there.
const outBase = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit out-')))
const outDir = join(outBase, 'run1')
const cleanTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-clean-')))
writeFileSync(join(cleanTarget, 'a.go'), 'package main\n', 'utf8')
const prep3 = JSON.parse(execFileSync('node',
  [cli, 'prepare', '--target', cleanTarget, '--output', outDir], { cwd: cleanTarget }).toString('utf8'))
assert.strictEqual(prep3.runDir, outDir)
assert.ok(existsSync(join(outDir, 'work', 'a.go')))
assert.ok(!existsSync(join(cleanTarget, '.secaudit')),
  'explicit external output must leave the target untouched')
assert.strictEqual(prep3.insideTarget, false)
assert.ok(!existsSync(join(outDir, '.gitignore')),
  'an output outside the target is nobody\'s working tree: no ignore file is written there')

// Overlap rejection end-to-end: output that contains the target.
let failed = null
try {
  execFileSync('node',
    [cli, 'prepare', '--target', join(target, 'src'), '--output', target],
    { cwd: target, stdio: 'pipe' })
} catch (err) { failed = err }
assert.strictEqual(JSON.parse(failed.stdout.toString('utf8')).error.code, 'E_OUTPUT_CONTAINS_TARGET')

// External symlinks: skipped from the copy, reported in the result.
try {
  symlinkSync(tmpdir(), join(target, 'ext-link'))
  const prep4 = JSON.parse(
    execFileSync('node', [cli, 'prepare', '--target', target], { cwd: target }).toString('utf8'))
  assert.deepStrictEqual(prep4.skippedExternalSymlinks, ['ext-link'])
  assert.ok(!existsSync(join(prep4.work, 'ext-link')))
} catch (err) {
  if (err.code !== 'EPERM') throw err
}

// A declared in-target --output works, and does not appear as an anomaly.
const nestedTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-nested-')))
writeFileSync(join(nestedTarget, 'main.go'), 'package main\n', 'utf8')
writeFileSync(join(nestedTarget, '.env'), 'API_KEY=live-secret\n', 'utf8')
execFileSync('git', ['init', '-q'], { cwd: nestedTarget })
execFileSync('git', [...gitEnv, 'add', 'main.go'], { cwd: nestedTarget })
execFileSync('git', [...gitEnv, 'commit', '-qm', 'init'], { cwd: nestedTarget })

const run1 = JSON.parse(execFileSync('node',
  [cli, 'prepare', '--target', nestedTarget, '--output', join(nestedTarget, 'reports', 'run1')],
  { cwd: nestedTarget }).toString('utf8'))
assert.strictEqual(run1.runDir, join(nestedTarget, 'reports', 'run1'))
assert.deepStrictEqual(run1.excludedRunDirs, [])

// The work tree holds a verbatim copy of the target's dotfile secrets, so an in-target output
// that git can see is one `git add -A` away from committing them. Ignoring is not a property of
// the DEFAULT path — it belongs to every run directory inside the target.
assert.strictEqual(readFileSync(join(run1.runDir, '.gitignore'), 'utf8'), '*\n')
assert.strictEqual(readFileSync(join(run1.work, '.env'), 'utf8'), 'API_KEY=live-secret\n')
assert.strictEqual(
  execFileSync('git', ['status', '--porcelain'], { cwd: nestedTarget }).toString('utf8'),
  '?? .env\n', 'an in-target --output must add nothing but the target\'s own untracked files')

// A LATER run at a different in-target --output must NOT silently prune run1's directory:
// pruning it would drop a subtree from enumeration, hashing, and every hunter while both
// sides of the pristine gate still agreed. Fail closed instead.
let run2Failed = null
try {
  execFileSync('node',
    [cli, 'prepare', '--target', nestedTarget, '--output', join(nestedTarget, 'reports', 'run2')],
    { cwd: nestedTarget, stdio: 'pipe' })
} catch (err) { run2Failed = err }
assert.ok(run2Failed, 'an undeclared run-marker directory must make prepare exit non-zero')
const run2Err = JSON.parse(run2Failed.stdout.toString('utf8')).error
assert.strictEqual(run2Err.code, 'E_UNDECLARED_RUN_DIR')
assert.match(run2Err.message, /reports\/run1/)
assert.ok(!existsSync(join(nestedTarget, 'reports', 'run2')),
  'a refused prepare must not create its run directory')

// A run marker planted anywhere in the audited repo is the Critical case: 42 bytes of JSON
// must never be able to hide a subtree from the audit.
const plantedTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit planted-')))
writeFileSync(join(plantedTarget, 'main.go'), 'package main\n', 'utf8')
mkdirSync(join(plantedTarget, 'hidden'))
writeFileSync(join(plantedTarget, 'hidden', 'evil.go'), 'package hidden\n', 'utf8')
writeFileSync(join(plantedTarget, 'hidden', 'secaudit-run.json'),
  '{"marker":"secaudit-run","formatVersion":1}', 'utf8')

let plantedFailed = null
try {
  execFileSync('node', [cli, 'prepare', '--target', plantedTarget],
    { cwd: plantedTarget, stdio: 'pipe' })
} catch (err) { plantedFailed = err }
assert.ok(plantedFailed, 'a planted run marker must make prepare exit non-zero')
const plantedErr = JSON.parse(plantedFailed.stdout.toString('utf8')).error
assert.strictEqual(plantedErr.code, 'E_UNDECLARED_RUN_DIR')
assert.match(plantedErr.message, /hidden/)
assert.deepStrictEqual(readdirSync(plantedTarget).sort(), ['hidden', 'main.go'],
  'a refused prepare must write no run directory and no work tree into the target')

// Work-tree isolation: an internal symlink whose target is ABSOLUTE still resolves into the
// audited repo unless it is rewritten, so a write through the work tree would mutate the corpus.
const absTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-abslink-')))
mkdirSync(join(absTarget, 'src'))
writeFileSync(join(absTarget, 'src', 'app.js'), 'ORIGINAL\n', 'utf8')
let absLinkMade = true
try {
  symlinkSync(join(absTarget, 'src', 'app.js'), join(absTarget, 'src', 'abs-alias.js'))
} catch (err) {
  if (err.code !== 'EPERM') throw err
  absLinkMade = false
}
if (absLinkMade) {
  const prepAbs = JSON.parse(
    execFileSync('node', [cli, 'prepare', '--target', absTarget], { cwd: absTarget }).toString('utf8'))
  const alias = join(prepAbs.work, 'src', 'abs-alias.js')
  assert.ok(lstatSync(alias).isSymbolicLink(), 'the internal symlink must still be a symlink')
  assert.strictEqual(readlinkSync(alias), join(prepAbs.work, 'src', 'app.js'),
    'an absolute internal symlink target must be rewritten into the work tree')
  writeFileSync(alias, 'PWNED\n', 'utf8')
  assert.strictEqual(readFileSync(join(absTarget, 'src', 'app.js'), 'utf8'), 'ORIGINAL\n',
    'a write through the work tree must never reach the audited corpus')
  assert.strictEqual(readFileSync(join(prepAbs.work, 'src', 'app.js'), 'utf8'), 'PWNED\n')

  // A relative internal symlink stays verbatim: it resolves inside the work tree already.
  const relTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-rellink-')))
  mkdirSync(join(relTarget, 'src'))
  writeFileSync(join(relTarget, 'src', 'app.js'), 'ORIGINAL\n', 'utf8')
  symlinkSync('app.js', join(relTarget, 'src', 'rel-alias.js'))
  const prepRel = JSON.parse(
    execFileSync('node', [cli, 'prepare', '--target', relTarget], { cwd: relTarget }).toString('utf8'))
  assert.strictEqual(readlinkSync(join(prepRel.work, 'src', 'rel-alias.js')), 'app.js')
  writeFileSync(join(prepRel.work, 'src', 'rel-alias.js'), 'PWNED\n', 'utf8')
  assert.strictEqual(readFileSync(join(relTarget, 'src', 'app.js'), 'utf8'), 'ORIGINAL\n')

  // An absolute target that reaches the corpus through an ALIAS path cannot be rewritten into
  // the work tree. Refuse the run rather than create a link that escapes the isolated copy.
  const aliasBase = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-alias-')))
  const escapeTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-escape-')))
  mkdirSync(join(escapeTarget, 'src'))
  writeFileSync(join(escapeTarget, 'src', 'app.js'), 'ORIGINAL\n', 'utf8')
  symlinkSync(escapeTarget, join(aliasBase, 'alias'))
  symlinkSync(join(aliasBase, 'alias', 'src', 'app.js'), join(escapeTarget, 'src', 'aliased.js'))
  let escapeFailed = null
  try {
    execFileSync('node', [cli, 'prepare', '--target', escapeTarget],
      { cwd: escapeTarget, stdio: 'pipe' })
  } catch (err) { escapeFailed = err }
  assert.ok(escapeFailed, 'an unrewritable internal symlink must make prepare exit non-zero')
  assert.strictEqual(JSON.parse(escapeFailed.stdout.toString('utf8')).error.code,
    'E_WORKTREE_SYMLINK_ESCAPE')
  assert.ok(!existsSync(join(escapeTarget, '.secaudit', 'runs')),
    'a refused prepare must not leave a work tree behind')
}

// The staged-copy case, which is the whole point of the project-root default: the target is a
// stripped copy with no .git of its own, the operator is standing in the real repository, and
// the report must land in that repository rather than in the copy — a scratch directory that
// the next cleanup deletes.
const homeRepo = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-home-')))
writeFileSync(join(homeRepo, 'kept.py'), 'x = 1\n', 'utf8')
execFileSync('git', ['init', '-q'], { cwd: homeRepo })
execFileSync('git', [...gitEnv, 'add', '-A'], { cwd: homeRepo })
execFileSync('git', [...gitEnv, 'commit', '-qm', 'init'], { cwd: homeRepo })

const staged = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-staged-')))
writeFileSync(join(staged, 'app.py'), 'print(1)\n', 'utf8')
writeFileSync(join(staged, '.env'), 'API_KEY=live-secret\n', 'utf8')

const prepStaged = JSON.parse(execFileSync('node',
  [cli, 'prepare', '--target', staged], { cwd: homeRepo }).toString('utf8'))
assert.strictEqual(prepStaged.artifactRoot, homeRepo)
assert.strictEqual(prepStaged.artifactRootSource, 'cwdGitRoot')
assert.strictEqual(prepStaged.runDir, join(homeRepo, '.secaudit', 'runs', prepStaged.runId))
assert.strictEqual(prepStaged.insideTarget, false)
assert.ok(existsSync(join(prepStaged.work, 'app.py')))
assert.ok(!existsSync(join(staged, '.secaudit')),
  'the audited copy must not collect the run directory')

// It lands in a working tree that is NOT the target, and the work tree still holds the corpus'
// dotfile secrets verbatim — so it has to ignore itself there too.
assert.strictEqual(readFileSync(join(prepStaged.runDir, '.gitignore'), 'utf8'), '*\n')
assert.strictEqual(readFileSync(join(prepStaged.work, '.env'), 'utf8'), 'API_KEY=live-secret\n')
assert.strictEqual(
  execFileSync('git', ['status', '--porcelain'], { cwd: homeRepo }).toString('utf8'),
  '', 'a run directory in the operator\'s repository must not dirty it')

// A subdirectory of a repository reports to the repository root, not into the audited subtree.
const subPrep = JSON.parse(execFileSync('node',
  [cli, 'prepare', '--target', join(target, 'src')], { cwd: target }).toString('utf8'))
assert.strictEqual(subPrep.artifactRoot, target)
assert.strictEqual(subPrep.artifactRootSource, 'targetGitRoot')
assert.strictEqual(subPrep.runDir, join(target, '.secaudit', 'runs', subPrep.runId))
assert.strictEqual(subPrep.insideTarget, false)
assert.ok(!existsSync(join(target, 'src', '.secaudit')))

console.log('PASS runtime-prepare')

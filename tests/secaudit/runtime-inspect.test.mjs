// tests/runtime-inspect.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const cli = join(repoRoot, 'skills/run/scripts/secaudit-runtime.mjs')

// `realpathSync.native`, not `realpathSync`, in every runtime test that compares a fixture
// path against the runtime's own output. The runtime canonicalizes with `realpath` from
// node:fs/promises, which routes to libuv (GetFinalPathNameByHandleW on Windows) and expands
// 8.3 short names; the JS walker behind plain `realpathSync` leaves them intact. On a Windows
// runner os.tmpdir() is C:\Users\RUNNER~1\..., so mixing the two compares RUNNER~1 against
// runneradmin. Identical behaviour on POSIX.
const target = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit inspect-'))) // space on purpose
writeFileSync(join(target, 'package.json'), '{}', 'utf8')
writeFileSync(join(target, 'app.js'), 'let x = 1\n', 'utf8')
mkdirSync(join(target, 'node_modules'))
writeFileSync(join(target, 'node_modules', 'dep.js'), 'x', 'utf8')

const out = JSON.parse(execFileSync('node', [cli, 'inspect', '--target', target]).toString('utf8'))
assert.strictEqual(out.target, target)
assert.strictEqual(out.coverage.sourceFiles, 1) // app.js only; .json is not a source extension
assert.deepStrictEqual(out.manifests, ['package.json'])
assert.strictEqual(out.extensions['.js'], 1)
assert.strictEqual(out.extensions['.json'], 1)
assert.deepStrictEqual(out.exclusionsApplied, ['node_modules'])
assert.ok(Array.isArray(out.exclusionPolicy) && out.exclusionPolicy.includes('.secaudit'))
assert.deepStrictEqual(out.warnings, [])

// Read-only: inspect must not create .secaudit or anything else in the target.
assert.ok(!existsSync(join(target, '.secaudit')))
assert.deepStrictEqual(readdirSync(target).sort(), ['app.js', 'node_modules', 'package.json'])

// Zero source files → a warning, still exit 0.
const emptyTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-empty-')))
writeFileSync(join(emptyTarget, 'README.rst'), 'docs only', 'utf8')
const emptyOut = JSON.parse(
  execFileSync('node', [cli, 'inspect', '--target', emptyTarget]).toString('utf8'))
assert.deepStrictEqual(emptyOut.warnings, ['no recognized source files under target'])

// An undeclared secaudit run marker hides a whole subtree from the audit. inspect is
// read-only reconnaissance so it stays exit 0, but the anomaly must be impossible to miss:
// the SKILL tells the operator to surface `warnings` verbatim, so it has to land there.
const plantedTarget = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit-planted-')))
writeFileSync(join(plantedTarget, 'app.js'), 'let x = 1\n', 'utf8')
mkdirSync(join(plantedTarget, 'hidden'))
writeFileSync(join(plantedTarget, 'hidden', 'evil.js'), 'evil()\n', 'utf8')
writeFileSync(join(plantedTarget, 'hidden', 'secaudit-run.json'),
  JSON.stringify({ marker: 'secaudit-run', formatVersion: 1 }), 'utf8')
const planted = JSON.parse(
  execFileSync('node', [cli, 'inspect', '--target', plantedTarget]).toString('utf8'))
assert.deepStrictEqual(planted.excludedRunDirs, ['hidden'])
assert.strictEqual(planted.coverage.sourceFiles, 1, 'hidden/evil.js is excluded from coverage')
assert.ok(planted.warnings.some(w => w.includes('hidden') && w.includes('secaudit-run.json')),
  'inspect must warn loudly about undeclared run-marker directories, got: '
  + JSON.stringify(planted.warnings))

// Failure contract: exit 1, one JSON error line on stdout, stable code.
let failed = null
try {
  execFileSync('node', [cli, 'inspect', '--target', join(target, 'missing')], { stdio: 'pipe' })
} catch (err) { failed = err }
assert.ok(failed, 'missing target must exit non-zero')
assert.strictEqual(JSON.parse(failed.stdout.toString('utf8')).error.code, 'E_TARGET_MISSING')

// Unknown flags fail loud; --help prints usage and exits 0.
let badFlag = null
try {
  execFileSync('node', [cli, 'inspect', '--tragte', target], { stdio: 'pipe' })
} catch (err) { badFlag = err }
assert.strictEqual(JSON.parse(badFlag.stdout.toString('utf8')).error.code, 'E_USAGE')
assert.match(execFileSync('node', [cli, 'inspect', '--help']).toString('utf8'), /Usage:/)

console.log('PASS runtime-inspect')

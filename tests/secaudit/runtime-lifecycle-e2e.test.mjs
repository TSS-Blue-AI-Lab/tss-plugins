// tests/secaudit/runtime-lifecycle-e2e.test.mjs
// The spec's exercise list: spaces in paths, target subdirectories, a project root separate
// from the corpus root, an explicit external output, and interrupted publication.
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const cli = join(root, 'skills/run/scripts/secaudit-runtime.mjs')
const gitEnv = ['-c', 'user.email=t@t', '-c', 'user.name=t']

function makeRepo(label) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit ' + label + '-')))
  mkdirSync(join(dir, 'api'))
  writeFileSync(join(dir, 'api', 'a.py'), 'a = 1\n', 'utf8')
  writeFileSync(join(dir, 'top.py'), 't = 1\n', 'utf8')
  execFileSync('git', [...gitEnv, 'init', '-q', dir])
  return dir
}

// 1. Explicit external output in a directory whose path contains a space.
{
  const target = makeRepo('e2e-target')
  const outParent = realpathSync.native(mkdtempSync(join(tmpdir(), 'secaudit e2e out-')))
  const out = join(outParent, 'run one')
  const prepared = JSON.parse(execFileSync('node',
    [cli, 'prepare', '--target', target, '--output', out], { encoding: 'utf8' }))
  assert.equal(prepared.runDir, out)
  assert.equal(prepared.work, join(out, 'work'))
  assert.equal(prepared.projectRoot, target)
  assert.ok(existsSync(join(out, 'work', 'api', 'a.py')))
  // The original source is untouched.
  assert.equal(readFileSync(join(target, 'api', 'a.py'), 'utf8'), 'a = 1\n')
}

// 2. Auditing a subdirectory of the target keeps the project root at the repository root.
{
  const target = makeRepo('e2e-sub')
  const prepared = JSON.parse(execFileSync('node',
    [cli, 'prepare', '--target', join(target, 'api')], { encoding: 'utf8' }))
  assert.equal(prepared.target, join(target, 'api'))
  assert.equal(prepared.projectRoot, target)
  assert.ok(prepared.runDir.startsWith(join(target, '.secaudit', 'runs')))
}

// 3. An interrupted run keeps its diagnostic state: the marker never claims completion.
{
  const target = makeRepo('e2e-interrupt')
  const prepared = JSON.parse(execFileSync('node',
    [cli, 'prepare', '--target', target], { encoding: 'utf8' }))
  const marker = JSON.parse(readFileSync(join(prepared.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'prepared')
  assert.ok(!('publishedUtc' in marker))
  // Nothing published, so the copied source is still there — visibly incomplete, not "clean".
  assert.ok(readdirSync(join(prepared.runDir, 'work')).length > 0)
}

console.log('runtime-lifecycle-e2e: ok')

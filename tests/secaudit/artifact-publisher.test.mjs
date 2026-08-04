import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync,
  unlinkSync,
} from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'
import { publishArtifacts } from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs'
import { enumerateSource, hashSource } from '../../plugins/secaudit/skills/run/scripts/source-corpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', 'plugins', 'secaudit')
const skillDir = join(root, 'skills/secaudit-generate-artifacts/scripts')
const scriptPath = join(skillDir, 'publish-artifacts.mjs')
// Fixtures are test-only data and live alongside this test file, not inside the shipped plugin.
const reportData = JSON.parse(readFileSync(join(here, 'fixtures/report-data.json'), 'utf8'))

// Mirrors what `prepare` records and what the publish gate recomputes: files AND symlinks.
async function corpusHash(dir) {
  const canonical = await realpath(dir)
  const { files, internalSymlinks, externalSymlinks } = await enumerateSource(canonical)
  return hashSource(canonical, files, [...internalSymlinks, ...externalSymlinks])
}

function makeTarget() {
  const target = mkdtempSync(join(tmpdir(), 'secaudit-target-'))
  writeFileSync(join(target, 'app.py'), 'print(1)\n', 'utf8')
  return target
}

// runDir carrying a valid secaudit ownership marker (or none, for the negative case).
function makeRunDir({ withMarker = true } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), 'secaudit-rundir-'))
  if (withMarker) {
    writeFileSync(join(runDir, 'secaudit-run.json'),
      JSON.stringify({ marker: 'secaudit-run', formatVersion: 1, runId: 'test-run' }), 'utf8')
  }
  return runDir
}

function populateWork(work) {
  const sastDir = join(work, 'sast')
  mkdirSync(sastDir)
  writeFileSync(join(sastDir, 'final-report.md'), '# Report\n', 'utf8')
  writeFileSync(join(sastDir, 'final-report.html'), '<html></html>', 'utf8')
  writeFileSync(join(sastDir, 'report-data.json'), JSON.stringify(reportData), 'utf8')
  writeFileSync(join(sastDir, 'run-ledger.json'), JSON.stringify({ stage: 'report', status: 'complete' }), 'utf8')
  // Scratch left over from earlier stages; must be pruned on success, left alone on rejection.
  mkdirSync(join(work, 'scratch'))
  writeFileSync(join(work, 'scratch', 'debug.log'), 'debug', 'utf8')
}

// The run directory's own work tree — this is the ONLY relationship publishArtifacts accepts.
function makeWork(runDir) {
  const work = join(runDir, 'work')
  mkdirSync(work)
  populateWork(work)
  return work
}

// --- Success path ---
{
  const target = makeTarget()
  const runDir = makeRunDir()
  const work = makeWork(runDir)
  const ledgerPath = join(work, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target)

  const summary = await publishArtifacts({
    target, expectedCorpusSha256, work, runDir, ledgerPath,
  })

  assert.deepStrictEqual(summary, { confirmed: 1, refuted: 2, manualReview: 2 })
  assert.strictEqual(readFileSync(join(runDir, 'report.md'), 'utf8'), '# Report\n')
  assert.strictEqual(readFileSync(join(runDir, 'report.html'), 'utf8'), '<html></html>')
  assert.ok(existsSync(join(runDir, 'trace.md')), 'trace.md must be written')
  const trace = readFileSync(join(runDir, 'trace.md'), 'utf8')
  assert.match(trace, /pristine/i)
  assert.match(trace, /"stage": "report"/, 'trace.md must include ledger contents')
  assert.match(trace, /sourceFiles|Source files/i, 'trace.md must include coverage metrics')
  assert.match(trace, /version/i, 'trace.md must include template version')
  assert.deepStrictEqual(readdirSync(work), ['sast'], 'work must only contain sast after publish')

  // No .tmp siblings must remain.
  for (const name of ['report.md.tmp', 'report.html.tmp', 'trace.md.tmp']) {
    assert.ok(!existsSync(join(runDir, name)), name + ' must not remain')
  }
}

// --- Non-pristine corpus: must reject and must NOT prune or copy anything ---
{
  const target = makeTarget()
  const runDir = makeRunDir()
  const work = makeWork(runDir)
  const ledgerPath = join(work, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target)

  // Mutate target AFTER the pre-hash was taken.
  writeFileSync(join(target, 'app.py'), 'print(2)\n', 'utf8')

  await assert.rejects(
    () => publishArtifacts({ target, expectedCorpusSha256, work, runDir, ledgerPath }),
    /corpus not pristine/,
  )

  assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch'], 'work must be untouched on rejection')
  assert.ok(!existsSync(join(runDir, 'report.md')), 'report.md must not be copied on rejection')
  assert.ok(!existsSync(join(runDir, 'report.html')), 'report.html must not be copied on rejection')
  assert.ok(!existsSync(join(runDir, 'trace.md')), 'trace.md must not be written on rejection')
}

// --- Input validation happens before mutation ---
{
  const target = makeTarget()
  const runDir = makeRunDir()
  const work = makeWork(runDir)
  await assert.rejects(
    () => publishArtifacts({ target, expectedCorpusSha256: 'not-a-hash', work, runDir, ledgerPath: join(work, 'sast', 'run-ledger.json') }),
    /expectedCorpusSha256/,
  )
  assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch'], 'invalid input must not mutate work')
}

// --- CLI: flags map correctly and print one JSON summary line ---
{
  const target = makeTarget()
  const runDir = makeRunDir()
  const work = makeWork(runDir)
  const ledgerPath = join(work, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target)
  const output = execFileSync('node', [
    scriptPath,
    '--target', target,
    '--expected-hash', expectedCorpusSha256,
    '--work', work,
    '--run-dir', runDir,
    '--ledger', ledgerPath,
  ]).toString('utf8').trim()
  assert.deepStrictEqual(JSON.parse(output), { confirmed: 1, refuted: 2, manualReview: 2 })
  assert.ok(existsSync(join(runDir, 'report.md')))
}

// --- Default-layout publish: runDir inside the target must not poison the pristine rehash ---
{
  const target = makeTarget()
  const runDir = join(target, '.secaudit', 'runs', 'r1')
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'secaudit-run.json'),
    JSON.stringify({ marker: 'secaudit-run', formatVersion: 1, runId: 'r1' }), 'utf8')
  const work = makeWork(runDir)
  const ledgerPath = join(work, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target) // marker dir auto-skipped → hash of sources only

  const summary = await publishArtifacts({
    target, expectedCorpusSha256, work, runDir, ledgerPath, templateVersion: 1,
  })
  assert.ok(summary, 'in-target runDir publish succeeds under the shared exclusion policy')
}

// --- Ownership gate: runDir with no (or invalid) marker must reject and must NOT prune work ---
{
  const target = makeTarget()
  const runDir = makeRunDir({ withMarker: false })
  const work = makeWork(runDir)
  const ledgerPath = join(work, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target)

  await assert.rejects(
    () => publishArtifacts({ target, expectedCorpusSha256, work, runDir, ledgerPath }),
    /not a secaudit run directory/,
  )
  assert.ok(existsSync(join(work, 'scratch', 'debug.log')), 'work must not be pruned when runDir has no ownership marker')
}

// --- Relationship gate: work pointing at some other directory must reject and must NOT prune it ---
{
  const target = makeTarget()
  const runDir = makeRunDir()
  const otherWork = mkdtempSync(join(tmpdir(), 'secaudit-otherwork-'))
  populateWork(otherWork)
  const ledgerPath = join(otherWork, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target)

  await assert.rejects(
    () => publishArtifacts({ target, expectedCorpusSha256, work: otherWork, runDir, ledgerPath }),
    /work must be the run directory's own work tree/,
  )
  assert.ok(existsSync(join(otherWork, 'scratch', 'debug.log')), 'unrelated work dir must not be pruned')
}

// --- Run marker planted AFTER prepare: publish must abort, not certify a pruned corpus ---
{
  const target = makeTarget()
  const runDir = makeRunDir()
  const work = makeWork(runDir)
  const ledgerPath = join(work, 'sast', 'run-ledger.json')
  const expectedCorpusSha256 = await corpusHash(target)

  // 42 bytes of JSON dropped into the audited repo used to remove the whole subtree from BOTH
  // sides of the gate, so the hashes agreed and trace.md certified "Pristine: true".
  mkdirSync(join(target, 'hidden'))
  writeFileSync(join(target, 'hidden', 'backdoor.py'), 'os.system(cmd)\n', 'utf8')
  writeFileSync(join(target, 'hidden', 'secaudit-run.json'),
    '{"marker":"secaudit-run","formatVersion":1}', 'utf8')

  await assert.rejects(
    () => publishArtifacts({ target, expectedCorpusSha256, work, runDir, ledgerPath }),
    /undeclared secaudit run marker/,
  )
  assert.ok(!existsSync(join(runDir, 'report.md')), 'no report.md on a pruned-corpus abort')
  assert.ok(!existsSync(join(runDir, 'report.html')), 'no report.html on a pruned-corpus abort')
  assert.ok(!existsSync(join(runDir, 'trace.md')), 'no pristine claim on a pruned-corpus abort')
  assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch'],
    'work must be untouched on a pruned-corpus abort')
}

// --- Symlink tampering after prepare must turn the pristine gate red ---
{
  const target = makeTarget()
  mkdirSync(join(target, 'src'))
  writeFileSync(join(target, 'src', 'app.py'), 'print(1)\n', 'utf8')
  let linkMade = true
  try {
    symlinkSync('app.py', join(target, 'src', 'alias.py'))
  } catch (err) {
    if (err.code !== 'EPERM') throw err
    linkMade = false
  }
  if (linkMade) {
    const runDir = makeRunDir()
    const work = makeWork(runDir)
    const ledgerPath = join(work, 'sast', 'run-ledger.json')
    const expectedCorpusSha256 = await corpusHash(target)

    // Retarget the symlink — no file content changes at all.
    unlinkSync(join(target, 'src', 'alias.py'))
    symlinkSync('../app.py', join(target, 'src', 'alias.py'))

    await assert.rejects(
      () => publishArtifacts({ target, expectedCorpusSha256, work, runDir, ledgerPath }),
      /corpus not pristine/,
    )
    assert.ok(!existsSync(join(runDir, 'trace.md')), 'no pristine claim after symlink tampering')
    assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch'])
  }
}

console.log('PASS artifact-publisher')

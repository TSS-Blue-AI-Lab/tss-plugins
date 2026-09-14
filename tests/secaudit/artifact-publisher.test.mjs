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
import { computeAnchor, fingerprintFor } from '../../plugins/secaudit/skills/issues/scripts/fingerprint.mjs'
import { emptyStore, writeStore } from '../../plugins/secaudit/skills/issues/scripts/issue-store.mjs'

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
      JSON.stringify({ marker: 'secaudit-run', formatVersion: 2, runId: 'test-run', state: 'prepared' }), 'utf8')
  }
  return runDir
}

function populateWork(work) {
  const sastDir = join(work, 'sast')
  mkdirSync(sastDir)
  writeFileSync(join(sastDir, 'report-data.json'), JSON.stringify(reportData), 'utf8')
  writeFileSync(join(sastDir, 'run-ledger.json'), JSON.stringify({ stage: 'report', status: 'complete' }), 'utf8')
  // The copied source the findings point at. Anchors are computed against this tree at publish
  // time, so a work tree without it exercises the wrong path.
  mkdirSync(join(work, 'src'), { recursive: true })
  for (const finding of reportData.findings) {
    const lines = Array.from({ length: finding.line }, (_, i) => 'const filler' + i + ' = ' + i)
    lines[finding.line - 1] = 'export function handler' + finding.line + '(req) { sink(req.q) }'
    writeFileSync(join(work, ...finding.path.split('/')), lines.join('\n') + '\n', 'utf8')
  }
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

// A complete, publishable run: pristine target, marked run directory, populated work tree.
async function makeRun() {
  const target = makeTarget()
  const runDir = makeRunDir()
  const work = makeWork(runDir)
  return {
    target, runDir, work,
    // The publisher reads the marker's projectRoot, falling back to the run directory when a
    // run records none — which is what these fixtures do.
    projectRoot: runDir,
    ledgerPath: join(work, 'sast', 'run-ledger.json'),
    corpus: await corpusHash(target),
  }
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

  assert.deepStrictEqual(
    { confirmed: summary.confirmed, refuted: summary.refuted, manualReview: summary.manualReview },
    { confirmed: 1, refuted: 2, manualReview: 2 })
  // Provenance and structured findings, and nothing else.
  assert.ok(existsSync(join(runDir, 'trace.md')), 'trace.md must be written')
  assert.ok(existsSync(join(work, 'sast', 'report-data.json')), 'report-data.json must survive the prune')
  assert.ok(!existsSync(join(runDir, 'report.md')), 'no rendered markdown report')
  assert.ok(!existsSync(join(runDir, 'report.html')), 'no rendered HTML report')
  const trace = readFileSync(join(runDir, 'trace.md'), 'utf8')
  assert.match(trace, /pristine/i)
  assert.match(trace, /"stage": "report"/, 'trace.md must include ledger contents')
  assert.strictEqual(trace.split('\n')[3], '- Target: ' + await realpath(target),
  'trace.md must name the tree the corpus hash was taken over — the run directory follows the '
  + 'project root, so it is not necessarily inside what was audited')
assert.match(trace, /sourceFiles|Source files/i, 'trace.md must include coverage metrics')
  assert.match(trace, /version/i, 'trace.md must include template version')
  assert.deepStrictEqual(readdirSync(work), ['sast'], 'work must only contain sast after publish')

  // No .tmp siblings must remain.
  for (const name of ['trace.md.tmp']) {
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

  assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch', 'src'], 'work must be untouched on rejection')
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
  assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch', 'src'], 'invalid input must not mutate work')
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
  const cliResult = JSON.parse(output)
  assert.deepStrictEqual(
    { confirmed: cliResult.confirmed, refuted: cliResult.refuted, manualReview: cliResult.manualReview },
    { confirmed: 1, refuted: 2, manualReview: 2 })
  assert.ok(existsSync(join(runDir, 'trace.md')))
}

// --- Default-layout publish: runDir inside the target must not poison the pristine rehash ---
{
  const target = makeTarget()
  const runDir = join(target, '.secaudit', 'runs', 'r1')
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'secaudit-run.json'),
    JSON.stringify({ marker: 'secaudit-run', formatVersion: 2, runId: 'r1', state: 'prepared' }), 'utf8')
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
  assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch', 'src'],
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
    assert.deepStrictEqual(readdirSync(work).sort(), ['sast', 'scratch', 'src'])
  }
}

// --- lifecycle + cleanup accounting ----------------------------------------
{
  const fixture = await makeRun()
  writeFileSync(join(fixture.work, 'leftover-source.py'), 'x = 1\n', 'utf8')

  const summary = await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  assert.equal(summary.state, 'complete')
  assert.ok(summary.cleanup.ok)
  assert.ok(summary.cleanup.removed.includes('leftover-source.py'))
  assert.deepEqual(summary.cleanup.remaining, ['sast'])
  assert.ok(!existsSync(join(fixture.work, 'leftover-source.py')))
  assert.ok(existsSync(join(fixture.work, 'sast', 'report-data.json')))

  const marker = JSON.parse(readFileSync(join(fixture.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'complete')
  assert.equal(typeof marker.publishedUtc, 'string')
  assert.deepEqual(marker.artifacts, ['trace.md'])
  assert.equal(marker.cleanup.ok, true)

  console.log('artifact-publisher lifecycle: ok')
}

// --- a non-pristine corpus leaves the marker untouched ----------------------
{
  const fixture = await makeRun()
  writeFileSync(join(fixture.target, 'app.py'), 'mutated = 1\n', 'utf8')

  await assert.rejects(publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  }), /corpus not pristine/)

  const marker = JSON.parse(readFileSync(join(fixture.runDir, 'secaudit-run.json'), 'utf8'))
  assert.equal(marker.state, 'prepared')       // never advanced
  assert.ok(!existsSync(join(fixture.runDir, 'trace.md')))

  console.log('artifact-publisher aborts without advancing state: ok')
}

// --- anchors are persisted before the source copy is pruned ----------------
{
  const fixture = await makeRun()   // its work tree still holds the copied source
  await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  const published = JSON.parse(
    readFileSync(join(fixture.work, 'sast', 'report-data.json'), 'utf8'))
  for (const finding of published.findings) {
    assert.equal(finding.anchor.version, 1)
    assert.ok(finding.anchor.fingerprint.startsWith('fp1:'))
    assert.equal(finding.anchor.codeHash.length, 16)
  }
  // The source copy is gone, but the anchors survived it.
  assert.deepEqual(readdirSync(fixture.work), ['sast'])

  console.log('artifact-publisher anchors: ok')
}

// --- a dismissed identity never reaches the actionable counts --------------
{
  const fixture = await makeRun()
  // Suppress the first finding by the fingerprint the publisher is about to compute for it.
  const target = JSON.parse(
    readFileSync(join(fixture.work, 'sast', 'report-data.json'), 'utf8')).findings[0]
  const anchor = computeAnchor({
    sourceText: readFileSync(join(fixture.work, ...target.path.split('/')), 'utf8'),
    line: target.line,
    path: target.path,
  })
  await writeStore(fixture.projectRoot, {
    ...emptyStore(),
    issues: [{
      id: 'iss_suppressed', class: target.class, path: target.path, line: target.line,
      title: target.title, severity: null, humanState: 'suppressed', ambiguous: false,
      fingerprints: [fingerprintFor({ class: target.class, path: target.path, ...anchor })],
      observations: [], evidence: {}, firstSeenRunId: 'old', lastSeenRunId: 'old',
      lastHumanUtc: '2026-01-01T00:00:00Z', events: [],
    }],
  })

  const summary = await publishArtifacts({
    target: fixture.target,
    expectedCorpusSha256: fixture.corpus,
    work: fixture.work,
    runDir: fixture.runDir,
    ledgerPath: fixture.ledgerPath,
  })

  assert.equal(summary.dismissed, 1)
  const published = JSON.parse(
    readFileSync(join(fixture.work, 'sast', 'report-data.json'), 'utf8'))
  const dismissed = published.findings.find(f => f.suppressed)
  // Still in the record, with its original verdict — grouped away, not deleted or rewritten.
  assert.ok(dismissed)
  assert.equal(dismissed.suppressedIssueId, 'iss_suppressed')
  assert.equal(dismissed.challengeVerdict, target.challengeVerdict)
  // And it is not counted among the findings the operator is being asked to act on.
  assert.equal(summary.confirmed + summary.refuted + summary.manualReview,
    published.findings.length - 1)

  console.log('artifact-publisher dismissal: ok')
}

console.log('PASS artifact-publisher')

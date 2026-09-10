// End-to-end integration test: drives the SAME CLI the workflow's Generate Artifacts phase
// runs (publish-artifacts.mjs) over the shared fixture report-data.json, exactly like a real
// assemble→publish run would, and asserts the run's deliverables land where the
// workflow/orchestrator promise they will.
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync,
} from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'
import { enumerateSource, hashSource } from '../../plugins/secaudit/skills/run/scripts/source-corpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', 'plugins', 'secaudit')
const skillDir = join(root, 'skills/secaudit-generate-artifacts/scripts')
const publishScript = join(skillDir, 'publish-artifacts.mjs')
// Fixtures are test-only data and live alongside this test file, not inside the shipped plugin.
const reportData = readFileSync(join(here, 'fixtures/report-data.json'), 'utf8')

// Same inputs `prepare` hashes: files AND symlink targets.
async function corpusHash(dir) {
  const canonical = await realpath(dir)
  const { files, internalSymlinks, externalSymlinks } = await enumerateSource(canonical)
  return hashSource(canonical, files, [...internalSymlinks, ...externalSymlinks])
}

// --- a temp target corpus (what Recon Prepare would have hashed) ---
const target = mkdtempSync(join(tmpdir(), 'secaudit-target-'))
writeFileSync(join(target, 'app.py'), 'print(1)\n', 'utf8')
const expectedCorpusSha256 = await corpusHash(target)

// --- run directory carrying the secaudit ownership marker, as `prepare` would have written it ---
const runDir = mkdtempSync(join(tmpdir(), 'secaudit-rundir-'))
writeFileSync(join(runDir, 'secaudit-run.json'),
  JSON.stringify({ marker: 'secaudit-run', formatVersion: 1, runId: 'integration-run' }), 'utf8')

// --- the run directory's own work/sast tree, seeded with the assembled report-data.json ---
const work = join(runDir, 'work')
mkdirSync(work)
const sastDir = join(work, 'sast')
mkdirSync(sastDir)
writeFileSync(join(sastDir, 'report-data.json'), reportData, 'utf8')

// --- run-ledger.json, as Generate Artifacts' Publish step would write it ---
const ledgerPath = join(sastDir, 'run-ledger.json')
writeFileSync(ledgerPath, JSON.stringify({
  stages: ['Recon / Prepare: demo@v1', 'Hunt: 3 hunters completed', 'Dedupe: deduped.md written'],
  hunters: ['businesslogic', 'idor', 'sqli'],
  blindspotSweep: false,
  blindspotReplayed: false,
  replayedHunterCount: 0,
  finalChallengeBatchCount: 3,
}), 'utf8')

// --- Publish: publish-artifacts.mjs CLI re-verifies pristine, copies, prunes, prints summary ---
const output = execFileSync('node', [
  publishScript,
  '--target', target,
  '--expected-hash', expectedCorpusSha256,
  '--work', work,
  '--run-dir', runDir,
  '--ledger', ledgerPath,
]).toString('utf8').trim()
const lastStdoutLine = output.split('\n').filter(Boolean).pop()

assert.deepStrictEqual(JSON.parse(lastStdoutLine), {
  confirmed: 1,
  refuted: 2,
  manualReview: 2,
})
assert.ok(existsSync(join(runDir, 'trace.md')), 'trace.md')
assert.ok(existsSync(join(work, 'sast', 'report-data.json')))
for (const name of ['report.md', 'report.html']) {
  assert.ok(!existsSync(join(runDir, name)), 'no rendered ' + name)
}
assert.deepStrictEqual(readdirSync(work), ['sast'])

console.log('PASS generate-artifacts-integration')

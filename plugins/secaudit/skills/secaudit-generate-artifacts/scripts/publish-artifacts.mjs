#!/usr/bin/env node
// secaudit-generate-artifacts publisher: copies the final report into the run
// directory and prunes the scratch work tree, but ONLY after re-verifying the
// source corpus hasn't changed since the audit ran. This is the security-critical
// gate: a non-pristine corpus must never cause a partial publish or a prune.
import { readdir, readFile, writeFile, rename, rm, stat, realpath } from 'node:fs/promises'
import { join, sep, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateReportData, summaryFor } from './report-contract.mjs'
import { enumerateSource, hashSource } from '../../run/scripts/source-corpus.mjs'
import { readMarker, MARKER_NAME } from '../../run/scripts/run-paths.mjs'

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('publish-artifacts: ' + label + ' is required')
  }
}

async function requireDirectory(path, label) {
  const st = await stat(path).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error('publish-artifacts: ' + label + ' is missing or not a directory: ' + path)
}

async function requireFile(path, label) {
  const st = await stat(path).catch(() => null)
  if (!st || !st.isFile()) throw new Error('publish-artifacts: ' + label + ' is missing or not a file: ' + path)
}

function buildTraceMd({ ledger, coverage, templateVersion, corpusSha256, target }) {
  return [
    '# Publish Trace',
    '',
    '## Corpus',
    '- Target: ' + target,
    '- Pristine: true',
    '- sha256: ' + corpusSha256,
    '',
    '## Coverage',
    '- Source files: ' + coverage.sourceFiles,
    '- Source lines: ' + coverage.sourceLines,
    '- Source bytes: ' + coverage.sourceBytes,
    '- Estimated source tokens: ' + coverage.estimatedSourceTokens,
    '',
    '## Template',
    '- Version: ' + templateVersion,
    '',
    '## Ledger',
    '```json',
    JSON.stringify(ledger, null, 2),
    '```',
    '',
  ].join('\n')
}

async function atomicWrite(path, content) {
  const tmpPath = path + '.tmp'
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, path)
}

async function pruneWorkExceptSast(work) {
  const entries = await readdir(work, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'sast') continue
    await rm(join(work, entry.name), { recursive: true, force: true })
  }
}

export async function publishArtifacts(options) {
  const {
    target, expectedCorpusSha256, work, runDir, ledgerPath, templateVersion = 1,
  } = options ?? {}

  // --- 1. Validate every required input BEFORE any mutation (or hashing). ---
  requireNonEmptyString(target, 'target')
  requireNonEmptyString(work, 'work')
  requireNonEmptyString(runDir, 'runDir')
  requireNonEmptyString(ledgerPath, 'ledgerPath')
  requireNonEmptyString(expectedCorpusSha256, 'expectedCorpusSha256')
  if (!/^[0-9a-f]{64}$/.test(expectedCorpusSha256)) {
    throw new Error('publish-artifacts: expectedCorpusSha256 must be a 64-character lowercase hex sha256')
  }
  if (!Number.isInteger(templateVersion) || templateVersion < 1) {
    throw new Error('publish-artifacts: templateVersion must be a positive integer')
  }

  await requireDirectory(target, 'target')
  await requireDirectory(work, 'work')
  await requireDirectory(runDir, 'runDir')

  const sastDir = join(work, 'sast')
  await requireDirectory(sastDir, 'work/sast')
  const finalMdPath = join(sastDir, 'final-report.md')
  const finalHtmlPath = join(sastDir, 'final-report.html')
  const reportDataPath = join(sastDir, 'report-data.json')
  await requireFile(finalMdPath, 'work/sast/final-report.md')
  await requireFile(finalHtmlPath, 'work/sast/final-report.html')
  await requireFile(reportDataPath, 'work/sast/report-data.json')
  await requireFile(ledgerPath, 'ledgerPath')

  // Ownership + relationship gate (spec: prune only a marked secaudit run's own work tree).
  // Without this, a stale --work from a different run would be pruned destructively.
  const marker = await readMarker(runDir)
  if (!marker) {
    throw new Error('publish-artifacts: runDir is not a secaudit run directory (missing or invalid ' + MARKER_NAME + '): ' + runDir)
  }
  const expectedWork = join(runDir, 'work')
  if (resolve(work) !== resolve(expectedWork)) {
    throw new Error('publish-artifacts: work must be the run directory\'s own work tree (expected ' + expectedWork + ', got ' + work + ')')
  }

  // --- 2. Recompute the corpus hash FIRST with the SAME exclusion policy prepare used:
  //        fixed denylist, marker-owned run dirs skipped, and the run dir itself excluded
  //        when it sits inside the target. Any mismatch aborts before any copy or prune. ---
  const canonicalTarget = await realpath(target)
  const canonicalRunDir = await realpath(runDir)
  const extraExcluded = canonicalRunDir.startsWith(canonicalTarget + sep) ? [canonicalRunDir] : []
  const { files, internalSymlinks, externalSymlinks, excludedRunDirs } =
    await enumerateSource(canonicalTarget, { extraExcluded })
  // The legitimate run directory is declared above, so anything left here is an UNDECLARED
  // secaudit-run.json marker whose subtree was dropped from the audit on both sides of this
  // gate — the hashes would agree and we would certify a pruned corpus as pristine. Abort.
  if (excludedRunDirs.length > 0) {
    throw new Error(
      'publish-artifacts: undeclared secaudit run marker directories inside the target hid part '
      + 'of the corpus from the audit: ' + excludedRunDirs.join(', ')
      + ' — refusing to publish or claim a pristine corpus',
    )
  }
  const actualCorpusSha256 = await hashSource(canonicalTarget, files,
    [...internalSymlinks, ...externalSymlinks])
  if (actualCorpusSha256 !== expectedCorpusSha256) {
    throw new Error(
      'publish-artifacts: corpus not pristine (expected ' + expectedCorpusSha256
      + ', got ' + actualCorpusSha256 + ')',
    )
  }

  const reportData = validateReportData(JSON.parse(await readFile(reportDataPath, 'utf8')))
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))

  // --- 3. Pristine: copy artifacts via .tmp siblings, rename only after each
  //        write succeeds, THEN prune the work tree. ---
  const summary = summaryFor(reportData.findings)
  const finalMd = await readFile(finalMdPath, 'utf8')
  const finalHtml = await readFile(finalHtmlPath, 'utf8')
  // The run directory follows the project root, so it is not necessarily inside what was
  // audited: the trace has to name the tree the hash was taken over.
  const traceMd = buildTraceMd({
    ledger, coverage: reportData.coverage, templateVersion, corpusSha256: actualCorpusSha256,
    target: canonicalTarget,
  })

  await atomicWrite(join(runDir, 'report.md'), finalMd)
  await atomicWrite(join(runDir, 'report.html'), finalHtml)
  await atomicWrite(join(runDir, 'trace.md'), traceMd)

  await pruneWorkExceptSast(work)

  return summary
}

function parseArgs(argv) {
  const flags = {
    '--target': 'target',
    '--expected-hash': 'expectedCorpusSha256',
    '--work': 'work',
    '--run-dir': 'runDir',
    '--ledger': 'ledgerPath',
  }
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const key = flags[argv[i]]
    if (!key) throw new Error('publish-artifacts: unknown argument ' + argv[i])
    options[key] = argv[++i]
  }
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  publishArtifacts(parseArgs(process.argv.slice(2)))
    .then(summary => console.log(JSON.stringify(summary)))
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}

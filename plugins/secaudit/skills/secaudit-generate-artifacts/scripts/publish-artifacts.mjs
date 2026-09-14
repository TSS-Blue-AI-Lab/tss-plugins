#!/usr/bin/env node
// secaudit-generate-artifacts publisher: writes the run's provenance trace into the
// run directory and prunes the scratch work tree, but ONLY after re-verifying the
// source corpus hasn't changed since the audit ran. This is the security-critical
// gate: a non-pristine corpus must never cause a partial publish or a prune.
// The human view is the Workbench dashboard, which reads work/sast/report-data.json; no
// rendered report is produced.
import { readdir, readFile, writeFile, rename, rm, stat, realpath } from 'node:fs/promises'
import { join, sep, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateReportData, summaryFor } from './report-contract.mjs'
import { enumerateSource, hashSource } from '../../run/scripts/source-corpus.mjs'
import { readMarker, updateMarker, MARKER_NAME } from '../../run/scripts/run-paths.mjs'
import { computeAnchor, fingerprintFor } from '../../issues/scripts/fingerprint.mjs'
import { suppressedIndex, markSuppressed } from '../../issues/scripts/known-issues.mjs'

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

// The copied source is temporary: it is removed on success and only the audit evidence stays.
// Returning the accounting (rather than nothing) is what lets the run refuse to claim success
// when a leftover survives — an operator who is told "clean" must actually be clean.
async function pruneWorkExceptSast(work) {
  const removed = []
  for (const entry of await readdir(work, { withFileTypes: true })) {
    if (entry.name === 'sast') continue
    await rm(join(work, entry.name), { recursive: true, force: true })
    removed.push(entry.name)
  }
  const remaining = (await readdir(work)).sort()
  return { removed: removed.sort(), remaining, ok: remaining.every(name => name === 'sast') }
}

// Anchors are computed HERE, and only here, because this is the last moment the copied source
// exists: the next statement prunes it, and the target itself may change the minute we finish.
// A finding whose file is missing from the copy (scoped out, or a path the model invented) is
// left without an anchor rather than anchored to a guess — import treats it as legacy identity.
export async function annotateAnchors(reportData, work) {
  const findings = []
  for (const finding of reportData.findings) {
    const sourceText = await readFile(join(work, ...finding.path.split('/')), 'utf8')
      .catch(() => null)
    if (sourceText == null) {
      findings.push({ ...finding, anchor: null })
      continue
    }
    const anchor = computeAnchor({ sourceText, line: finding.line, path: finding.path })
    findings.push({
      ...finding,
      anchor: {
        version: 1,
        ...anchor,
        fingerprint: fingerprintFor({ class: finding.class, path: finding.path, ...anchor }),
      },
    })
  }
  return { ...reportData, findings }
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
  const reportDataPath = join(sastDir, 'report-data.json')
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
  // The run directory follows the project root, so it is not necessarily inside what was
  // audited: the trace has to name the tree the hash was taken over.
  const traceMd = buildTraceMd({
    ledger, coverage: reportData.coverage, templateVersion, corpusSha256: actualCorpusSha256,
    target: canonicalTarget,
  })

  await atomicWrite(join(runDir, 'trace.md'), traceMd)

  // Anchors first, then dismissal: a finding cannot be matched against the archive until it
  // has an identity. Both happen before the prune, while the source copy still exists.
  const anchored = await annotateAnchors(reportData, work)
  const projectRoot = marker.projectRoot ?? marker.artifactRoot ?? runDir
  const dismissed = markSuppressed(anchored, await suppressedIndex(projectRoot))
  validateReportData(dismissed)
  await atomicWrite(reportDataPath, JSON.stringify(dismissed, null, 2) + '\n')

  const publishedUtc = new Date().toISOString()
  await updateMarker(runDir, {
    state: 'published',
    publishedUtc,
    artifacts: ['trace.md'],
  })

  const cleanup = await pruneWorkExceptSast(work)
  const state = cleanup.ok ? 'complete' : 'cleanup-incomplete'
  await updateMarker(runDir, { state, cleanup })

  return { ...summaryFor(dismissed.findings), state, cleanup }
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
    .then(result => {
      console.log(JSON.stringify(result))
      if (!result.cleanup.ok) {
        console.error('publish-artifacts: the copied source was NOT fully removed; these entries '
          + 'remain under the work tree: ' + result.cleanup.remaining.join(', ')
          + ' — the run is recorded as cleanup-incomplete, delete them by hand')
        process.exitCode = 1
      }
    })
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}

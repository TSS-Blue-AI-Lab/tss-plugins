// plugins/secaudit/skills/issues/scripts/run-import.mjs
// Reads a run's structured evidence. READ ONLY: the reports are the audit record, and importing
// them must never edit them. Two layouts exist in the wild — <run>/sast (older runs, published
// after their work tree was flattened) and <run>/work/sast (current) — and both stay supported.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readMarker } from '../../run/scripts/run-paths.mjs'
import { validateReportData } from '../../secaudit-generate-artifacts/scripts/report-contract.mjs'
import { legacyFingerprintFor } from './fingerprint.mjs'

async function isFile(path) {
  const st = await stat(path).catch(() => null)
  return Boolean(st?.isFile())
}

export async function findReportData(runDir) {
  for (const candidate of [
    join(runDir, 'sast', 'report-data.json'),
    join(runDir, 'work', 'sast', 'report-data.json'),
  ]) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

function toObservation(finding, runId) {
  const anchored = finding.anchor?.fingerprint
  return {
    observationId: finding.id,
    runId,
    class: finding.class,
    path: finding.path,
    line: finding.line,
    title: finding.title,
    severity: finding.severity ?? null,
    challengeVerdict: finding.challengeVerdict,
    challengeReason: finding.challengeReason,
    traceVerdict: finding.traceVerdict ?? null,
    traceEvidence: finding.traceEvidence ?? null,
    impact: finding.impact ?? null,
    remediation: finding.remediation ?? null,
    dynamicTest: finding.dynamicTest ?? null,
    fingerprint: anchored ?? legacyFingerprintFor(finding),
    fingerprintKind: anchored ? 'anchor' : 'legacy',
  }
}

export async function importRun(runDir) {
  const marker = await readMarker(runDir)
  const runId = marker?.runId ?? null
  const unavailable = reason => ({ runId, runDir, status: 'unavailable', reason })
  if (!marker) return unavailable('not a secaudit run directory (missing or invalid marker)')

  const reportPath = await findReportData(runDir)
  // "No report" is not "no findings". A run that never published must read as unfinished on the
  // board, or an interrupted audit looks like a clean bill of health.
  if (!reportPath) return unavailable('no report-data.json under ' + runDir + ' (sast/ or work/sast/)')

  let reportData
  try {
    reportData = validateReportData(JSON.parse(await readFile(reportPath, 'utf8')))
  } catch (err) {
    return unavailable('unreadable report-data.json: ' + err.message)
  }

  return {
    runId,
    runDir,
    createdUtc: marker.createdUtc ?? null,
    target: marker.target ?? null,
    scope: marker.scope ?? [],
    status: 'ok',
    observations: reportData.findings.map(f => toObservation(f, runId)),
  }
}

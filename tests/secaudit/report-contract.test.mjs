import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateReportData, findingId, classifyFinding, sortFindings,
  summaryFor, escapeHtml, formatDate,
} from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs'
import { missingArtifacts } from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/verify-artifacts.mjs'

// Fixtures are test-only data and live alongside this test file, not inside the shipped plugin.
const here = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(here, 'fixtures/report-data.json'), 'utf8'))
assert.deepStrictEqual(validateReportData(data), data)
for (const finding of data.findings) assert.strictEqual(finding.id, findingId(finding))
assert.deepStrictEqual(data.findings.map(classifyFinding), [
  { bucket: 'confirmed', manualKind: null },
  { bucket: 'manual-review', manualKind: 'runtime-proof' },
  { bucket: 'refuted', manualKind: null },
  { bucket: 'refuted', manualKind: null },
  { bucket: 'manual-review', manualKind: 'defect-determination' },
])
assert.deepStrictEqual(summaryFor(data.findings),
  { confirmed: 1, refuted: 2, manualReview: 2, dismissed: 0 })
// A dismissed finding is counted once, as dismissed, and drops out of the actionable buckets.
assert.deepStrictEqual(
  summaryFor(data.findings.map((f, i) => (i === 0 ? { ...f, suppressed: true } : f))),
  { confirmed: 0, refuted: 2, manualReview: 2, dismissed: 1 })
assert.strictEqual(sortFindings([...data.findings])[0].title, 'Forced mode bypass')
assert.strictEqual(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;')
assert.strictEqual(formatDate('2026-07-16'), '16 July 2026')

const duplicate = structuredClone(data)
duplicate.findings[1].id = duplicate.findings[0].id
assert.throws(() => validateReportData(duplicate), /duplicate finding id/)
const invalid = structuredClone(data)
invalid.findings[0].traceVerdict = null
assert.throws(() => validateReportData(invalid), /DEFECT requires Trace/)

const emptyTitle = structuredClone(data)
emptyTitle.findings[0].title = '   '
assert.throws(() => validateReportData(emptyTitle), /finding\.title is required/)
const emptyReason = structuredClone(data)
emptyReason.findings[0].challengeReason = ''
assert.throws(() => validateReportData(emptyReason), /finding\.challengeReason is required/)

// missingArtifacts: a deliverable counts as present only if it exists with >0 bytes; -1 (missing),
// 0 (empty), or a non-integer size must be flagged — the fail-loud gate that stops a publish agent
// reporting success while having written nothing.
const reportDataRel = join('work', 'sast', 'report-data.json')
assert.deepStrictEqual(missingArtifacts({ traceMd: 5, reportData: 20 }), [])
assert.deepStrictEqual(missingArtifacts({ traceMd: 5, reportData: -1 }), [reportDataRel])
assert.deepStrictEqual(missingArtifacts({ traceMd: 0, reportData: 20 }), ['trace.md'])
assert.deepStrictEqual(missingArtifacts({}), ['trace.md', reportDataRel])

console.log('PASS report-contract')

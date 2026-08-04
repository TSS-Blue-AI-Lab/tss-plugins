import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateReportData, findingId, classifyFinding, sortFindings,
  summaryFor, escapeHtml, formatDate,
} from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs'
import { fillTemplate } from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/render-report.mjs'
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
  { confirmed: 1, refuted: 2, manualReview: 2 })
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

// fillTemplate: injected finding text may legitimately contain brace pairs (e.g. AngularJS
// `{{expr}}` quoted from the audited source) — it must render verbatim, not be mistaken for an
// unfilled template token. Regression for a renderer that scanned the FILLED output.
const filled = fillTemplate('# {{PROJECT}}\n{{CONFIRMED_FINDINGS}}',
  { PROJECT: 'demo', CONFIRMED_FINDINGS: 'href="{{child.url}}" and {{expr}}' })
assert.strictEqual(filled, '# demo\nhref="{{child.url}}" and {{expr}}')
// A genuinely unfilled/misspelled TEMPLATE token still throws.
assert.throws(() => fillTemplate('{{PROJCT}}', { PROJECT: 'demo' }),
  /unresolved template token \{\{PROJCT\}\}/)

// missingArtifacts: a deliverable counts as present only if it exists with >0 bytes; -1 (missing),
// 0 (empty), or a non-integer size must be flagged — the fail-loud gate that stops a publish agent
// reporting success while having written nothing.
assert.deepStrictEqual(missingArtifacts({ reportMd: 10, reportHtml: 20, traceMd: 5 }), [])
assert.deepStrictEqual(missingArtifacts({ reportMd: 10, reportHtml: -1, traceMd: 5 }), ['report.html'])
assert.deepStrictEqual(missingArtifacts({ reportMd: 0, reportHtml: 20, traceMd: 0 }), ['report.md', 'trace.md'])
assert.deepStrictEqual(missingArtifacts({}), ['report.md', 'report.html', 'trace.md'])

console.log('PASS report-contract')

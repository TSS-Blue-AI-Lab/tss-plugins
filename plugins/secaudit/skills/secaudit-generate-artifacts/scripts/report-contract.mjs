import { createHash } from 'node:crypto'

export const ALL_HUNTERS = [
  'businesslogic', 'fileupload', 'graphql', 'hardcodedsecrets', 'idor', 'jwt',
  'missingauth', 'pathtraversal', 'rce', 'sqli', 'ssrf', 'ssti', 'xss', 'xxe',
]
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low']
const SEVERITY_RANK = new Map(SEVERITIES.map((value, index) => [value, index]))
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function requireValue(condition, message) {
  if (!condition) throw new Error('report-data: ' + message)
}
function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}
function isUtcDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function findingId(finding) {
  const path = finding.path.replaceAll('\\', '/')
  const hash = createHash('sha256').update(finding.title, 'utf8').digest('hex').slice(0, 12)
  return finding.class + '@' + path + ':' + finding.line + '@' + hash
}

export function classifyFinding(finding) {
  if (finding.challengeVerdict === 'NOT-A-DEFECT') return { bucket: 'refuted', manualKind: null }
  if (finding.challengeVerdict === 'UNSURE') {
    return { bucket: 'manual-review', manualKind: 'defect-determination' }
  }
  if (finding.traceVerdict === 'REACHABLE') return { bucket: 'confirmed', manualKind: null }
  if (finding.traceVerdict === 'UNREACHABLE') return { bucket: 'refuted', manualKind: null }
  if (finding.traceVerdict === 'NEEDS-PROOF') {
    return { bucket: 'manual-review', manualKind: 'runtime-proof' }
  }
  throw new Error('report-data: DEFECT requires Trace')
}

function validateMetadata(metadata) {
  requireValue(metadata && typeof metadata === 'object', 'metadata is required')
  requireValue(nonEmpty(metadata.project), 'metadata.project is required')
  requireValue(isUtcDate(metadata.generatedDate), 'metadata.generatedDate must be a valid UTC date (YYYY-MM-DD)')
  requireValue(Array.isArray(metadata.hunters), 'metadata.hunters must be an array')
  const seen = new Set()
  for (const hunter of metadata.hunters) {
    requireValue(ALL_HUNTERS.includes(hunter), 'metadata.hunters contains an unknown hunter: ' + hunter)
    requireValue(!seen.has(hunter), 'metadata.hunters contains a duplicate hunter: ' + hunter)
    seen.add(hunter)
  }
}

function validateCoverage(coverage) {
  requireValue(coverage && typeof coverage === 'object', 'coverage is required')
  for (const key of ['sourceFiles', 'sourceLines', 'sourceBytes', 'estimatedSourceTokens']) {
    requireValue(Number.isInteger(coverage[key]) && coverage[key] >= 0, 'coverage.' + key + ' must be a non-negative integer')
  }
  requireValue(
    coverage.estimatedSourceTokens === Math.ceil(coverage.sourceBytes / 4),
    'coverage.estimatedSourceTokens must equal Math.ceil(sourceBytes / 4)',
  )
}

function validateFinding(finding, seenIds) {
  requireValue(nonEmpty(finding.title), 'finding.title is required')
  requireValue(nonEmpty(finding.challengeReason), 'finding.challengeReason is required')
  requireValue(ALL_HUNTERS.includes(finding.class), 'finding.class is unknown: ' + finding.class)
  requireValue(finding.path === finding.path.replaceAll('\\', '/'), 'finding.path must be normalized to forward slashes: ' + finding.path)
  requireValue(Number.isInteger(finding.line) && finding.line >= 1, 'finding.line must be a positive integer')
  requireValue(!seenIds.has(finding.id), 'duplicate finding id: ' + finding.id)
  seenIds.add(finding.id)
  requireValue(finding.id === findingId(finding), 'finding.id does not match findingId(finding): ' + finding.id)

  requireValue(finding.suppressed === undefined || typeof finding.suppressed === 'boolean',
    'finding.suppressed must be a boolean when present')
  requireValue(
    finding.suppressedIssueId === undefined || finding.suppressedIssueId === null
      || nonEmpty(finding.suppressedIssueId),
    'finding.suppressedIssueId must be a non-empty string or null',
  )

  // Optional: historical report-data.json predates anchors, and a finding whose source file
  // was not in the copy is published without one. Present but malformed is still a hard error.
  if (finding.anchor !== undefined && finding.anchor !== null) {
    const a = finding.anchor
    requireValue(a && typeof a === 'object', 'finding.anchor must be an object when present')
    requireValue(a.version === 1, 'finding.anchor.version must be 1')
    requireValue(['decl', 'file'].includes(a.anchorKind), 'finding.anchor.anchorKind is invalid: ' + a.anchorKind)
    requireValue(nonEmpty(a.anchorName), 'finding.anchor.anchorName is required')
    requireValue(/^[0-9a-f]{16}$/.test(a.codeHash), 'finding.anchor.codeHash must be 16 lowercase hex characters')
    requireValue(/^fp1:[0-9a-f]{24}$/.test(a.fingerprint), 'finding.anchor.fingerprint must be fp1:<24 hex>')
  }

  const { challengeVerdict, traceVerdict } = finding
  requireValue(
    ['DEFECT', 'NOT-A-DEFECT', 'UNSURE'].includes(challengeVerdict),
    'finding.challengeVerdict is invalid: ' + challengeVerdict,
  )
  if (challengeVerdict === 'DEFECT') {
    requireValue(
      ['REACHABLE', 'UNREACHABLE', 'NEEDS-PROOF'].includes(traceVerdict),
      'DEFECT requires Trace verdict of REACHABLE, UNREACHABLE, or NEEDS-PROOF',
    )
    requireValue(nonEmpty(finding.traceEvidence), 'DEFECT findings require traceEvidence')
  } else {
    requireValue(traceVerdict === null, 'NOT-A-DEFECT and UNSURE findings must have a null traceVerdict')
  }
  requireValue(
    finding.severity === null || SEVERITIES.includes(finding.severity),
    'finding.severity is invalid: ' + finding.severity,
  )

  const { bucket, manualKind } = classifyFinding(finding)
  if (bucket === 'confirmed' || manualKind === 'runtime-proof') {
    requireValue(nonEmpty(finding.severity), 'severity is required for Confirmed and runtime-proof findings')
    requireValue(nonEmpty(finding.impact), 'impact is required for Confirmed and runtime-proof findings')
    requireValue(nonEmpty(finding.remediation), 'remediation is required for Confirmed and runtime-proof findings')
  }
  if (bucket === 'refuted' || manualKind === 'defect-determination') {
    requireValue(finding.severity === null, 'severity must be null for Refuted and defect-determination findings')
  }
  if (manualKind === 'runtime-proof') {
    requireValue(nonEmpty(finding.dynamicTest), 'dynamicTest is required for runtime-proof findings')
  }
}

export function validateReportData(data) {
  requireValue(data && typeof data === 'object', 'data must be an object')
  requireValue(data.schemaVersion === 1, 'schemaVersion must be 1')
  validateMetadata(data.metadata)
  validateCoverage(data.coverage)
  requireValue(Array.isArray(data.findings), 'findings must be an array')
  const seenIds = new Set()
  for (const finding of data.findings) validateFinding(finding, seenIds)
  return data
}

const BUCKET_RANK = { confirmed: 0, refuted: 1, 'manual-review': 2 }
const MANUAL_KIND_RANK = { 'runtime-proof': 0, 'defect-determination': 1 }

function sortKey(finding) {
  const { bucket, manualKind } = classifyFinding(finding)
  return {
    bucketRank: BUCKET_RANK[bucket],
    manualRank: manualKind === null ? 0 : MANUAL_KIND_RANK[manualKind],
    severityRank: finding.severity === null ? SEVERITIES.length : SEVERITY_RANK.get(finding.severity),
  }
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    if (ka.bucketRank !== kb.bucketRank) return ka.bucketRank - kb.bucketRank
    if (ka.manualRank !== kb.manualRank) return ka.manualRank - kb.manualRank
    if (ka.severityRank !== kb.severityRank) return ka.severityRank - kb.severityRank
    const classCmp = a.class.toLowerCase().localeCompare(b.class.toLowerCase())
    if (classCmp !== 0) return classCmp
    const titleCmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase())
    if (titleCmp !== 0) return titleCmp
    const pathCmp = a.path.toLowerCase().localeCompare(b.path.toLowerCase())
    if (pathCmp !== 0) return pathCmp
    return a.line - b.line
  })
}

export function summaryFor(findings) {
  const counts = { confirmed: 0, refuted: 0, manualReview: 0, dismissed: 0 }
  for (const finding of findings) {
    // A finding a human already dismissed is counted once, here, and nowhere else. Leaving it
    // in the actionable buckets as well is what makes a board look like it never shrinks.
    if (finding.suppressed) { counts.dismissed += 1; continue }
    const { bucket } = classifyFinding(finding)
    if (bucket === 'confirmed') counts.confirmed += 1
    else if (bucket === 'refuted') counts.refuted += 1
    else counts.manualReview += 1
  }
  return counts
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Neutralizes HTML-forming characters so a Markdown finding field can't render
// as live markup when report.md is passed through an HTML-rendering Markdown
// engine (GitHub/GitLab/wikis). Escape & first to avoid double-escaping.
export function escapeMarkdown(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return day + ' ' + MONTHS[month - 1] + ' ' + year
}

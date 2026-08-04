#!/usr/bin/env node
// secaudit-generate-artifacts renderer: fills the fixed report templates from
// validated report-data.json. Deterministic reshape, no LLM.
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  validateReportData, classifyFinding, sortFindings, summaryFor, escapeHtml, escapeMarkdown, formatDate,
} from './report-contract.mjs'

const DEFAULT_MD_TEMPLATE = new URL('../templates/report.md.tmpl', import.meta.url)
const DEFAULT_HTML_TEMPLATE = new URL('../templates/report.html.tmpl', import.meta.url)

const MANUAL_KIND_LABELS = {
  'runtime-proof': 'Runtime proof required',
  'defect-determination': 'Defect determination required',
}

export function fillTemplate(template, tokens) {
  // Validate the TEMPLATE's own placeholders against known keys BEFORE substituting — injected
  // finding text can legitimately contain brace pairs (e.g. AngularJS `{{expr}}` quoted from the
  // audited source), so scanning the FILLED output would mis-flag that data as an unfilled token.
  const known = new Set(Object.keys(tokens))
  for (const [token, name] of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
    if (!known.has(name)) throw new Error('render-report: unresolved template token ' + token)
  }
  // ONE pass over the template, never over our own output. A per-token loop rescans what it has
  // already substituted, so a value containing a LATER token's placeholder gets expanded too —
  // audited source that happens to spell `{{SOURCE_LINES}}` would splice the real coverage
  // number, or a whole finding record, into wherever it appeared.
  //
  // The callback also matters: with a string replacement, `$$`, `$&`, `` $` `` and `$'` are
  // substitution patterns, so a finding quoting `A$$5` would render as `A$5`. A function
  // replacement inserts the value verbatim.
  //
  // Every placeholder in the template was checked against `known` above, so `tokens[name]` is
  // always present here.
  return template.replace(/\{\{([^{}]+)\}\}/g, (_match, name) => tokens[name])
}

function findingRows(finding) {
  const rows = [
    ['Location', finding.path + ':' + finding.line],
    ['Challenge', finding.challengeReason],
  ]
  if (finding.traceEvidence) rows.push(['Trace evidence', finding.traceEvidence])
  if (finding.impact) rows.push(['Impact', finding.impact])
  if (finding.remediation) rows.push(['Remediation', finding.remediation])
  if (finding.dynamicTest) rows.push(['Dynamic test', finding.dynamicTest])
  return rows
}

function findingHtml(finding, isOpen) {
  const { manualKind } = classifyFinding(finding)
  const badges = ['<span class="finding-meta">' + escapeHtml(finding.class) + '</span>']
  if (finding.severity) badges.push('<span class="finding-meta">' + escapeHtml(finding.severity) + '</span>')
  if (manualKind) badges.push('<span class="substatus">' + MANUAL_KIND_LABELS[manualKind] + '</span>')
  const dl = findingRows(finding)
    .map(([key, value]) => '<dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(value) + '</dd>')
    .join('')
  return (
    '<details' + (isOpen ? ' open' : '') + '>'
    + '<summary><span class="finding-title">' + escapeHtml(finding.title) + '</span></summary>'
    + '<div class="finding-body">' + badges.join('') + '<dl>' + dl + '</dl></div>'
    + '</details>'
  )
}

function findingsHtml(findings, firstOpen) {
  if (findings.length === 0) return '<p class="note">None.</p>'
  return findings.map((finding, index) => findingHtml(finding, firstOpen && index === 0)).join('\n')
}

function findingMd(finding) {
  const { manualKind } = classifyFinding(finding)
  const lines = ['### ' + escapeMarkdown(finding.title) + ' (' + finding.class + ' — ' + escapeMarkdown(finding.path) + ':' + finding.line + ')']
  if (finding.severity) lines.push('- Severity: ' + finding.severity)
  if (manualKind) lines.push('- Status: ' + MANUAL_KIND_LABELS[manualKind])
  // Escape every row (including Location's path) — a repo file path can carry
  // HTML-forming characters just like the attacker-influenceable finding text.
  for (const [key, value] of findingRows(finding)) {
    lines.push('- ' + key + ': ' + escapeMarkdown(value))
  }
  return lines.join('\n')
}

function findingsMd(findings) {
  if (findings.length === 0) return '_None._'
  return findings.map(findingMd).join('\n\n')
}

function summaryHtml(summary) {
  return (
    '<div class="count">Confirmed<strong>' + summary.confirmed + '</strong></div>'
    + '<div class="count">Refuted<strong>' + summary.refuted + '</strong></div>'
    + '<div class="count">Manual Review<strong>' + summary.manualReview + '</strong></div>'
  )
}

function coverageHtml(coverage) {
  return (
    '<div class="coverage">'
    + '<div class="coverage-item">Source lines in scope<strong>' + coverage.sourceLines + '</strong></div>'
    + '<div class="coverage-item">Source files in scope<strong>' + coverage.sourceFiles + '</strong></div>'
    + '<div class="coverage-item">Estimated source tokens<strong>' + coverage.estimatedSourceTokens + '</strong></div>'
    + '</div>'
    + '<p class="note">Estimated source tokens are ceil(source bytes / 4), not model usage.</p>'
  )
}

function buildReplacements(data, groups, summary) {
  const generated = formatDate(data.metadata.generatedDate)
  const hunters = data.metadata.hunters.join(', ')
  const md = {
    PROJECT: data.metadata.project,
    GENERATED: generated,
    HUNTERS: hunters,
    CONFIRMED_COUNT: String(summary.confirmed),
    REFUTED_COUNT: String(summary.refuted),
    MANUAL_COUNT: String(summary.manualReview),
    CONFIRMED_FINDINGS: findingsMd(groups.confirmed),
    REFUTED_FINDINGS: findingsMd(groups.refuted),
    MANUAL_FINDINGS: findingsMd(groups.manual),
    SOURCE_LINES: String(data.coverage.sourceLines),
    SOURCE_FILES: String(data.coverage.sourceFiles),
    SOURCE_TOKENS: String(data.coverage.estimatedSourceTokens),
  }
  const html = {
    PROJECT: escapeHtml(data.metadata.project),
    GENERATED: escapeHtml(generated),
    HUNTERS: escapeHtml(hunters),
    SUMMARY: summaryHtml(summary),
    CONFIRMED_FINDINGS: findingsHtml(groups.confirmed, true),
    REFUTED_FINDINGS: findingsHtml(groups.refuted, false),
    MANUAL_FINDINGS: findingsHtml(groups.manual, false),
    COVERAGE: coverageHtml(data.coverage),
  }
  return { md, html }
}

function atomicWrite(path, content) {
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, content, 'utf8')
  renameSync(tmpPath, path)
}

export async function renderReports(options) {
  const {
    dataPath, markdownTemplatePath = DEFAULT_MD_TEMPLATE, htmlTemplatePath = DEFAULT_HTML_TEMPLATE,
    outMarkdown, outHtml,
  } = options
  const data = validateReportData(JSON.parse(readFileSync(dataPath, 'utf8')))
  const sorted = sortFindings([...data.findings])
  const summary = summaryFor(sorted)
  const groups = {
    confirmed: sorted.filter(f => classifyFinding(f).bucket === 'confirmed'),
    refuted: sorted.filter(f => classifyFinding(f).bucket === 'refuted'),
    manual: sorted.filter(f => classifyFinding(f).bucket === 'manual-review'),
  }
  const replacements = buildReplacements(data, groups, summary)
  const markdown = fillTemplate(readFileSync(markdownTemplatePath, 'utf8'), replacements.md)
  const html = fillTemplate(readFileSync(htmlTemplatePath, 'utf8'), replacements.html)
  atomicWrite(outMarkdown, markdown)
  atomicWrite(outHtml, html)
  return summary
}

function parseArgs(argv) {
  const flags = { '--data': 'dataPath', '--out-md': 'outMarkdown', '--out-html': 'outHtml' }
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const key = flags[argv[i]]
    if (!key) throw new Error('render-report: unknown argument ' + argv[i])
    options[key] = argv[++i]
  }
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  renderReports(parseArgs(process.argv.slice(2))).catch(err => {
    console.error(err.message)
    process.exitCode = 1
  })
}

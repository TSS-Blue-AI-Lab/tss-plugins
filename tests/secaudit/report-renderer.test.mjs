import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert'
import { renderReports } from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/render-report.mjs'
import { findingId, escapeHtml, escapeMarkdown } from '../../plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', 'plugins', 'secaudit')
const skillDir = join(root, 'skills/secaudit-generate-artifacts')
const scriptsDir = join(skillDir, 'scripts')
const mdTemplate = join(skillDir, 'templates/report.md.tmpl')
const htmlTemplate = join(skillDir, 'templates/report.html.tmpl')
// Fixtures are test-only data and live alongside this test file, not inside the shipped plugin.
const dataPath = join(here, 'fixtures/report-data.json')
const expectedMd = readFileSync(join(here, 'fixtures/report.expected.md'), 'utf8')
const expectedHtml = readFileSync(join(here, 'fixtures/report.expected.html'), 'utf8')

async function render(dataFile) {
  const outDir = mkdtempSync(join(tmpdir(), 'secaudit-render-'))
  const outMarkdown = join(outDir, 'report.md')
  const outHtml = join(outDir, 'report.html')
  await renderReports({
    dataPath: dataFile, markdownTemplatePath: mdTemplate, htmlTemplatePath: htmlTemplate,
    outMarkdown, outHtml,
  })
  return { markdown: readFileSync(outMarkdown, 'utf8'), html: readFileSync(outHtml, 'utf8') }
}

const { markdown, html } = await render(dataPath)

assert.strictEqual(markdown, expectedMd, 'markdown output does not match golden byte-for-byte')
assert.strictEqual(html, expectedHtml, 'html output does not match golden byte-for-byte')

assert.ok(!/filter/i.test(html))
assert.ok(!/<script\b/i.test(html))
assert.ok(!/https?:\/\//i.test(html))
for (const label of ['Confirmed', 'Refuted', 'Manual Review', 'Assessment Coverage']) {
  assert.ok(html.includes(label), 'missing ' + label)
}
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? ''
for (const label of ['Security Assessment Report', 'Project', 'Generated', 'Hunters run']) {
  assert.ok(header.includes(label), 'missing header field ' + label)
}
assert.doesNotMatch(header, />\s*(Scans?|Scope|Findings)\s*</i)
for (const coverageLabel of [
  'Source lines in scope', 'Source files in scope', 'Estimated source tokens',
]) assert.ok(html.includes(coverageLabel), 'missing coverage label ' + coverageLabel)
assert.ok(!html.includes('Source bytes'), 'source bytes belong in trace.md, not the dashboard')

// Both manual sub-statuses must be visible (fixture has one of each).
assert.ok(html.includes('Runtime proof required'), 'missing runtime-proof substatus')
assert.ok(html.includes('Defect determination required'), 'missing defect-determination substatus')

// Hostile clone: an XSS payload in a title must render escaped, never as a live tag.
const hostileData = JSON.parse(readFileSync(dataPath, 'utf8'))
hostileData.findings[0].title = '<img src=x onerror=alert(1)>'
hostileData.findings[0].id = findingId(hostileData.findings[0])
const hostileDataPath = join(mkdtempSync(join(tmpdir(), 'secaudit-render-hostile-')), 'report-data.json')
writeFileSync(hostileDataPath, JSON.stringify(hostileData), 'utf8')
const { markdown: hostileMarkdown, html: hostileHtml } = await render(hostileDataPath)
assert.ok(hostileHtml.includes('&lt;img src=x onerror=alert(1)&gt;'), 'hostile title must be escaped')
assert.ok(!/<img\b/i.test(hostileHtml), 'hostile title must not render as a live <img> tag')
assert.ok(hostileMarkdown.includes('&lt;img src=x onerror=alert(1)&gt;'), 'hostile title must be escaped in markdown')
assert.ok(!/<img\b/i.test(hostileMarkdown), 'hostile title must not render as a live <img> tag in markdown')
assert.ok(!/<script\b/i.test(hostileMarkdown), 'hostile title must not render as a live <script> tag in markdown')

// Dollar-substitution clone: `$$`, `$&`, `` $` `` and `$'` are replacement patterns for a STRING
// replacement, so finding text quoting them would be silently rewritten (`A$$5` → `A$5`, `` $` ``
// duplicating the preceding template). They must survive verbatim into both outputs.
{
  const dollarTitle = "cost A$$5 and $& and $` and $' end"
  const dollarData = JSON.parse(readFileSync(dataPath, 'utf8'))
  dollarData.findings[0].title = dollarTitle
  dollarData.findings[0].id = findingId(dollarData.findings[0])
  const dollarPath = join(mkdtempSync(join(tmpdir(), 'secaudit-render-dollar-')), 'report-data.json')
  writeFileSync(dollarPath, JSON.stringify(dollarData), 'utf8')
  const { markdown: dollarMd, html: dollarHtml } = await render(dollarPath)
  const cases = [
    // [name, output, escaper, marker BEFORE the injection point, marker AFTER it]
    ['markdown', dollarMd, escapeMarkdown, '| Category | Count |', '## Assessment Coverage'],
    ['html', dollarHtml, escapeHtml, '<!doctype html>', '</html>'],
  ]
  for (const [name, out, escape, before, after] of cases) {
    assert.ok(
      out.includes(escape(dollarTitle)),
      `${name} must hold $ sequences literally ($$ must not collapse to $)`,
    )
    // `$&` would re-emit the matched placeholder itself.
    assert.ok(!out.includes('{{CONFIRMED_FINDINGS}}'), `${name} must not re-emit a token via $&`)
    // `` $` `` duplicates everything before the match, `$'` everything after.
    assert.strictEqual(out.split(before).length - 1, 1, `${name} duplicated template context via $\``)
    assert.strictEqual(out.split(after).length - 1, 1, `${name} duplicated template context via $'`)
  }
}

// Rescan clone: a per-token substitution loop reads back its OWN output, so a value containing a
// LATER token's placeholder gets expanded as well. Audited source can spell `{{SOURCE_LINES}}` —
// an Angular/Vue interpolation, or a finding quoting this very report format — and the escapers
// leave `{{` alone. The dollar cases above cannot catch this: they exercise the replacement
// string, not a second pass over the result.
{
  const injected = 'quoted from source: {{SOURCE_LINES}} / {{MANUAL_FINDINGS}} / {{TRACE_TABLE}}'
  const rescanData = JSON.parse(readFileSync(dataPath, 'utf8'))
  rescanData.findings[0].title = injected
  rescanData.findings[0].id = findingId(rescanData.findings[0])
  const rescanPath = join(mkdtempSync(join(tmpdir(), 'secaudit-render-rescan-')), 'report-data.json')
  writeFileSync(rescanPath, JSON.stringify(rescanData), 'utf8')
  const { markdown: rescanMd, html: rescanHtml } = await render(rescanPath)
  for (const [name, out, escape] of [['markdown', rescanMd, escapeMarkdown], ['html', rescanHtml, escapeHtml]]) {
    assert.ok(
      out.includes(escape(injected)),
      `${name} must carry a finding's {{TOKEN}} text through verbatim, not substitute it`,
    )
  }
}

// Leftover-token rejection: an unresolved {{TOKEN}} in the template must throw naming it.
{
  const badTmplDir = mkdtempSync(join(tmpdir(), 'secaudit-render-badtmpl-'))
  const badTemplate = join(badTmplDir, 'bad.tmpl')
  writeFileSync(badTemplate, '{{DOES_NOT_EXIST}}', 'utf8')
  const badOutDir = mkdtempSync(join(tmpdir(), 'secaudit-render-badout-'))
  await assert.rejects(
    () => renderReports({
      dataPath, markdownTemplatePath: badTemplate, htmlTemplatePath: htmlTemplate,
      outMarkdown: join(badOutDir, 'report.md'), outHtml: join(badOutDir, 'report.html'),
    }),
    /unresolved template token \{\{DOES_NOT_EXIST\}\}/,
    'leftover template token must throw naming it',
  )
}

// CLI arg-parsing: --data/--out-md/--out-html map correctly and default templates resolve
// (no template flags given).
{
  const renderReportPath = join(scriptsDir, 'render-report.mjs')
  const cliOutDir = mkdtempSync(join(tmpdir(), 'secaudit-render-cli-'))
  const cliOutMd = join(cliOutDir, 'report.md')
  const cliOutHtml = join(cliOutDir, 'report.html')
  execFileSync('node', [renderReportPath, '--data', dataPath, '--out-md', cliOutMd, '--out-html', cliOutHtml])
  assert.strictEqual(readFileSync(cliOutMd, 'utf8'), expectedMd, 'CLI markdown output does not match golden')
  assert.strictEqual(readFileSync(cliOutHtml, 'utf8'), expectedHtml, 'CLI html output does not match golden')
}

console.log('PASS report-renderer')

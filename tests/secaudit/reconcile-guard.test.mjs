// The reconcile guard is the backstop that stops an un-converted [FINDING] from vanishing at
// Dedupe (only [DEFECT] carries forward) — a false-clean report. Its rule lives in an agent
// PROMPT, so it cannot be executed here; what this test can do is (a) read the prompt the SHIPPED
// workflow actually sends, anchored so a semantic inversion of the rule cannot satisfy it, and
// (b) drive the real workflow through both guard outcomes with stub agents. A local re-statement
// of the rule checked against local fixtures would prove nothing about the shipped file.
import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow, promptFor } from './workflow-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Reference implementation of the rule the prompt states, used below to derive the residual list
// the stub guard reports back — so the fixtures feed a real run of the shipped workflow.
const TAGS = [
  'FINDING', 'VULNERABLE', 'LIKELY VULNERABLE', 'NEEDS MANUAL REVIEW',
  'NOT VULNERABLE', 'EXPLOITABLE', 'LIKELY EXPLOITABLE', 'NOT EXPLOITABLE',
]
const HEAD = new RegExp('^###\\s*\\[(' + TAGS.join('|') + ')\\]')
export function residualFindings(md) {
  const lines = md.split('\n')
  const residual = []
  for (let i = 0; i < lines.length; i++) {
    if (!HEAD.test(lines[i])) continue
    let converted = false
    for (let j = i + 1; j < lines.length && !/^###\s/.test(lines[j]); j++) {
      if (/\*\*Challenge:\*\*/.test(lines[j])) { converted = true; break }
    }
    if (!converted) residual.push(lines[i].trim())
  }
  return residual
}

const unconverted = readFileSync(join(here, 'fixtures/results-unconverted.md'), 'utf8')
const converted = readFileSync(join(here, 'fixtures/results-converted.md'), 'utf8')
assert.strictEqual(residualFindings(unconverted).length, 1, 'un-converted fixture has exactly one residual finding')
assert.strictEqual(residualFindings(converted).length, 0, 'converted fixture has no residual findings')

// ---- 1. The prompt the shipped workflow really sends. Throws if the guard was deleted. ----
const { calls } = await runWorkflow()
const prompt = promptFor(calls, 'reconcile-guard')

// The rule must be stated in the UN-CONVERTED direction: heading present AND no **Challenge:**
// line. Inverting it ("has a **Challenge:** line") would make the guard report every CONVERTED
// finding as residual and never catch the real failure — so assert the direction, both ways.
assert.match(prompt, /\bhas NO\b[^.]{0,60}\*\*Challenge:\*\*/,
  'guard prompt must define UN-CONVERTED as: no **Challenge:** line follows the finding heading')
assert.doesNotMatch(prompt, /\bHAS?\s+(a|an|its|the)\b[^.]{0,60}\*\*Challenge:\*\*/i,
  'guard prompt must not be inverted into flagging findings that DO carry a **Challenge:** line')
// Its search window is bounded by the next heading or EOF, and it enumerates rather than judges.
assert.match(prompt, /before the next[^.]*heading or end of file/i, 'guard prompt bounds the search window')
assert.match(prompt, /do not judge/i, 'guard is enumeration only — verdicts belong to Challenge')
// Every legacy tag family the fixtures represent must be named, or a stale-tagged finding slips through.
for (const tag of TAGS) {
  assert.ok(prompt.includes('[' + tag + ']'), `guard prompt must name the [${tag}] heading family`)
}
assert.ok(prompt.includes('sast/*-results.md'), 'guard reads every hunter results file, not one')

// ---- 2. Behaviour: what the workflow DOES with each guard outcome. ----
// Residual findings reported → the run aborts and names them. (A guard whose result is ignored,
// or which is never called at all, fails here.)
{
  const residual = residualFindings(unconverted).map(heading => ({ file: 'sast/sqli-results.md', heading }))
  const err = await runWorkflow({
    reply: ({ label }) => (label === 'reconcile-guard' ? { residual } : undefined),
  }).then(() => null, e => e)
  assert.ok(err, 'a non-empty residual list must abort the run')
  assert.match(err.message, /un-converted by Challenge|reached Dedupe un-converted/, err.message)
  assert.ok(err.message.includes(residual[0].heading), 'the abort must name the offending finding')
  assert.strictEqual(err.calls.filter(c => c.label === 'dedupe').length, 0,
    'the run must not reach Dedupe with un-converted findings')
}
// Zero residual → the run proceeds to Dedupe and the ledger records the clean guard pass.
{
  const { notes, calls: ok } = await runWorkflow({
    reply: ({ label }) => (label === 'reconcile-guard' ? { residual: [] } : undefined),
  })
  assert.strictEqual(ok.filter(c => c.label === 'dedupe').length, 1, 'a clean guard pass proceeds to Dedupe')
  assert.ok(notes.some(n => /Reconcile: all findings converted \(0 residual\)/.test(n)),
    'a clean guard pass is recorded in the ledger')
}

console.log('PASS reconcile-guard rule')

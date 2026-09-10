import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkflow, callsFor, promptFor, PREPARED } from './workflow-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const wf = join(root, 'workflows/secaudit.js')
const src = readFileSync(wf, 'utf8')

const EXPECTED = ['Recon', 'Hunt', 'Challenge', 'Blindspot Sweep', 'Dedupe', 'Trace', 'Generate Artifacts']

// 1. meta export present.
assert.match(src, /export const meta\s*=/, 'meta export block')

// 2. No while-loops — Blindspot Sweep re-hunt must be if-bounded.
assert.ok(!/\bwhile\s*\(/.test(src), 'no while loops (re-hunt must be if-bounded)')

// 3. Stage order: first-occurrence of each phase() equals the spec order.
const seen = []
for (const m of src.matchAll(/phase\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  if (!seen.includes(m[1])) seen.push(m[1])
}
assert.deepStrictEqual(seen, EXPECTED, `phase() first-occurrence order ${JSON.stringify(seen)} != spec`)

// 4. meta.phases titles are exactly the phase() set, IN THE SAME ORDER (Task 7: the 7
// final phases, exact sequence — not just same membership).
const titles = [...src.matchAll(/title:\s*['"]([^'"]+)['"]/g)].map(m => m[1])
assert.deepStrictEqual(titles, EXPECTED, 'meta.phases order != EXPECTED phase order')

// 4b. Retired phase names must not appear anywhere as a bare phase() call (Task 7: Report and
// Harvest are folded into the single deterministic Generate Artifacts phase).
for (const retired of ['Setup', 'Validate', 'Gapfill', 'Feedback', 'Report', 'Harvest']) {
  assert.doesNotMatch(src, new RegExp("phase\\(\\s*['\"]" + retired + "['\"]"), `retired phase '${retired}' must not appear`)
}

// 4c. Task 7: Generate Artifacts wiring — the artifact package's scripts/files and the
// carried-forward run metadata must be referenced by the workflow.
for (const required of [
  'secaudit-generate-artifacts',
  'report-data.json',
  'publish-artifacts.mjs',
  'traceBatch',
  'blindspotSweep',
  'hunters',
]) assert.match(src, new RegExp(required), `workflow must reference '${required}'`)
// The rendered report is retired: the dashboard is the human view. Asserted gone so a
// reintroduced render stage fails the suite rather than quietly coming back.
assert.ok(!/render-report|artifacts:render/.test(src), 'workflow must not run a report renderer')

// 5. Fan-out present: parallel() used at least twice (Hunt + Challenge).
assert.ok((src.match(/parallel\(/g) || []).length >= 2, 'parallel() fan-out for Hunt and Challenge')

// 6. SCA fully removed from the workflow (it is a standalone skill now).
assert.ok(!/secaudit-sca|trivy/i.test(src), 'SCA/Trivy removed from workflow')

// 7. Generate Artifacts' Publish step re-verifies the corpus is pristine before copying/pruning.
assert.match(src, /pristine|unchanged|byte-identical/i, 'corpus pristine-check referenced')

// 8. Cost controls: traceBatch knob present; profile presets removed.
assert.match(src, /const traceBatch\s*=/, 'traceBatch cost knob')
assert.ok(!/PROFILES/.test(src), 'profile presets removed (hunter selection moved to launcher)')

// 9. Blindspot Sweep off by default, if-gated exactly once; Feedback fully removed.
assert.ok(!/\bwhile\s*\(/.test(src))
assert.match(src, /const blindspotSweep\s*=\s*opts\.blindspotSweep\s*===\s*true/)
assert.strictEqual((src.match(/if\s*\(\s*blindspotSweep\s*\)/g) || []).length, 1)
assert.match(src, /secaudit-blindspot-sweep/)
assert.match(src, /blindspot-tasks\.md/)
assert.match(src, /huntRound\([^)]*':blindspot'[^)]*2\)/)
assert.match(src, /if\s*\(\s*sweep\.hasTasks\s*\)/)
assert.strictEqual((src.match(/huntRound\([^)]*':blindspot'/g) || []).length, 1)
assert.ok(!/secaudit-feedback|feedback-tasks|phase\(\s*['"]Feedback/.test(src))

// 10. Challenge fans out one challenger PER HUNTER (label challenge:<class>), not per finding.
assert.match(src, /challenge:\$\{cls\}/, 'per-hunter Challenge label')
assert.ok(!/challenge:\$\{f\.file\}/.test(src), 'no per-finding Challenge fan-out')

// 11. hunters REQUIRED: no silent all-14 default (guards a dropped launcher selection).
//     Asserted BEHAVIOURALLY below ("hunters is required") — a text-level negative regex is
//     pinned to one spelling, and a positive one is satisfied by a comment.

// 12. Robust arg parsing: a JSON-encoded string args payload is parsed, not treated as a path.
assert.match(src, /JSON\.parse/, 'workflow parses a JSON-string args payload (harness may stringify)')

// 13. Hunt fails LOUD on incomplete coverage after a bounded retry — no silent 0-hunter clean
//     report. Asserted BEHAVIOURALLY below: a `note()` with the same text satisfies a message
//     regex, and a `// attempt <= 2` comment satisfies a retry-bound regex.

// 14. Challenge groups findings by detector class → one challenger per class with findings.
assert.match(src, /byClass/, 'Challenge groups findings by detector class')
assert.ok(!/Math\.ceil\(\s*findings\.length\s*\/\s*maxAgents\s*\)/.test(src), 'Challenge no longer size-batches (per-detector now)')

// 15. S2: single-agent artifact stages retried once then fail loud via robustAgent.
assert.match(src, /async function robustAgent/, 'robustAgent wrapper present')
assert.ok((src.match(/robustAgent\(/g) || []).length >= 6, 'robustAgent used for recon/collect/dedupe(x2)/trace(x2)/artifacts(x3)')

// 16. Preparation moved into the run skill (deterministic runtime): the workflow consumes
// prepared-run inputs instead of running collect-metrics.mjs, and is handshake-gated so
// only the run skill can start it (spec review decision 1).
assert.ok(!/collect-metrics\.mjs/.test(src), 'workflow no longer invokes collect-metrics.mjs')
assert.match(src, /launchToken/, 'handshake gate present')
assert.match(src, /prepared-run input/, 'workflow validates prepared-run inputs from the run skill')
assert.match(src, /corpusSha256/, 'corpusSha256 threaded from prepare into Generate Artifacts')
assert.match(src, /generatedDate/, 'generatedDate threaded from prepare into Generate Artifacts')
const gateIdx = src.indexOf('launchToken')
const firstAgentIdx = src.indexOf("label: 'recon:map'")
assert.ok(gateIdx > -1 && gateIdx < firstAgentIdx, 'handshake gate fires before any agent is dispatched')

// 17. Challenge batches also fail loud: a dead Challenge batch is retried then throws (else its
//     findings silently drop from Dedupe — same false-clean class as a dead hunter).
//     Asserted BEHAVIOURALLY below (a note() with this text would satisfy a source-text match).

// 18. Trace is batched + parallel like Challenge (no single mega-agent over all DEFECTs), race-safe
//     (read-only batches return verdicts; one merge agent writes), and fails loud.
assert.match(src, /trace:batch/, 'Trace fans out per batch (not one agent over all DEFECTs)')
assert.match(src, /trace-merge/, 'Trace uses a single merge writer to avoid concurrent deduped.md edits')
assert.match(src, /Trace batch\(es\) failed after retry/, 'Trace batches fail loud on death')
assert.ok((src.match(/traceDefects\(\)/g) || []).length >= 1, 'traceDefects invoked for the Trace stage')

// 19. Re-hunt is append-only: prompt forbids rewriting existing sections and names a round number.
// (backtick is optionally backslash-escaped: it sits inside a template literal, where a literal
// backtick MUST be escaped as \` to stay valid JS — the un-escaped form would be a syntax error.)
assert.match(src, /append ONE new \\?`## Round \$\{roundNum\}\\?`|append a new \\?`## Round/i, 'scoped re-hunt appends a new Round section')
assert.match(src, /do NOT rewrite|must not (modify|rewrite)/i, 're-hunt forbids rewriting existing sections')
// 20. huntRound takes a roundNum and the first hunt passes 1.
assert.match(src, /function huntRound\(\s*scope\s*,\s*tag\s*,\s*roundNum/, 'huntRound gains a roundNum parameter')
assert.match(src, /huntRound\(\s*null\s*,\s*''\s*,\s*1\s*\)/, 'first hunt passes roundNum=1')

// 21. Reconcile guard: after Challenge, un-converted findings abort the run (fail-loud).
assert.match(src, /reconcileGuard/, 'reconcile guard present')
assert.match(src, /reached Dedupe un-converted|un-converted by Challenge/i, 'guard throws on un-converted findings')
assert.match(src, /await reconcileGuard\(\)/, 'guard invoked from challengeNewFindings')

// 22. Prefix-stable dispatch: the hunter prompt leads with the shared, class-independent
//     preamble+architecture reference BEFORE any per-detector (${cls}) interpolation.
const huntPrompt = src.slice(src.indexOf('const run = async cls =>'))
const firstShared = huntPrompt.indexOf('sast/architecture.md')
const firstCls = huntPrompt.indexOf('${cls}')
assert.ok(firstShared > -1 && firstCls > -1, 'hunter prompt references architecture.md and ${cls}')
assert.ok(firstShared < firstCls, 'shared prefix (architecture.md ref) must precede the first ${cls} interpolation')

// 23. Reconcile guard must run even when collect() reports zero new findings — asserted
//     BEHAVIOURALLY below. Any early return, however spelled, is caught there; a text search for
//     one literal spelling of the condition is not.

// pluginRoot is a required prepared-run input: the workflow has no filesystem, shell, or
// environment access, so it cannot discover the plugin root itself. Missing it would mean
// every agent prompt points at a path that only exists in the developer's checkout. Its
// validation is asserted behaviourally below.
assert.ok(
  !/\bskills\/(sast-analysis|sast-hunter-|secaudit-)/.test(src.replace(/\$\{SKILLS\}\//g, '')),
  'no agent prompt interpolates a bare repo-relative skills/ path',
)
const skillRefs = src.match(/\$\{SKILLS\}\//g) ?? []
assert.ok(
  skillRefs.length >= 7,
  `every bundled resource reference goes through SKILLS (found ${skillRefs.length}, expected >= 7)`,
)
assert.match(src, /const SKILLS = pluginRoot \+ '\/skills'/, 'SKILLS derives from pluginRoot')
// The launcher targets the namespaced plugin workflow, so meta.name must stay 'secaudit'.
assert.match(src, /name: 'secaudit',/, "meta.name is 'secaudit' (installs as /secaudit:secaudit)")

console.log('PASS validate-workflow structural checks')

// ===========================================================================================
// BEHAVIOURAL CHECKS. Everything above reads source TEXT, which a comment or an equivalent
// rename satisfies. These run the real workflow with stub agents and assert what it DOES.
// ===========================================================================================

const ALL = [
  'businesslogic', 'fileupload', 'graphql', 'hardcodedsecrets', 'idor', 'jwt',
  'missingauth', 'pathtraversal', 'rce', 'sqli', 'ssrf', 'ssti', 'xss', 'xxe',
]

// B0. Sanity: a well-formed launch runs all seven stages in order and returns the run summary.
{
  const { result, phases, calls } = await runWorkflow()
  assert.deepStrictEqual([...new Set(phases)], EXPECTED.filter(p => p !== 'Blindspot Sweep'),
    'happy path visits every stage except the opt-in sweep, in order')
  assert.strictEqual(result.runDir, PREPARED.runDir)
  assert.strictEqual(result.hunterCount, PREPARED.hunters.length)
  // pluginRoot really is the prefix of every skill path an agent is handed.
  assert.match(promptFor(calls, 'recon:map'), /\/plugin\/skills\/sast-analysis\/SKILL\.md/,
    'agent prompts resolve skills under the passed-in pluginRoot')
  assert.match(promptFor(calls, 'hunt:sqli'), /\/plugin\/skills\/sast-hunter-sqli\/SKILL\.md/)
}

// B1. Every prepared-run input is validated for SHAPE, not just presence: '' and a wrong type are
// as broken as absent, and nothing may be dispatched before they are all checked.
for (const [key, kind] of [
  ['work', 'string'], ['runDir', 'string'], ['runId', 'string'], ['coverage', 'object'],
  ['corpusSha256', 'string'], ['generatedDate', 'string'], ['pluginRoot', 'string'],
]) {
  const bads = kind === 'string' ? [undefined, null, '', '   ', 42, true, {}, []] : [undefined, null, '', 'x', 7, []]
  for (const bad of bads) {
    const args = { ...PREPARED, [key]: bad }
    if (bad === undefined) delete args[key]
    await assert.rejects(
      () => runWorkflow({ args }),
      err => {
        assert.ok(err.message.includes("'" + key + "'"),
          `rejection for ${key}=${JSON.stringify(bad) ?? 'undefined'} must name the offending key, got: ${err.message}`)
        assert.strictEqual(err.calls.length, 0, 'no agent may be dispatched on an invalid prepared-run input')
        return true
      },
      `${key}=${JSON.stringify(bad) ?? 'undefined'} must be rejected, not accepted`,
    )
  }
}

// B2. pluginRoot prefixes every skill path in every prompt. A relative path resolves against
// whatever cwd an agent happens to have, and `${CLAUDE_PLUGIN_ROOT}` is expanded only in skill
// and agent CONTENT — never in a workflow script — so an unexpanded placeholder really arrives.
// Each half is pinned independently: the placeholder cases include an ABSOLUTE one (which the
// absolute-path guard would wave through) and the relative cases include placeholder-free ones.
for (const bad of [
  '${CLAUDE_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}/plugin', '/opt/plugins/${CLAUDE_PLUGIN_ROOT}',
  '/opt/${HOME}/plugin', 'plugin', './plugin', 'skills/..', 'plugin/${CLAUDE_PLUGIN_ROOT}',
]) {
  await assert.rejects(
    () => runWorkflow({ args: { ...PREPARED, pluginRoot: bad } }),
    /pluginRoot/,
    `pluginRoot '${bad}' must be rejected (unexpanded placeholder or relative)`,
  )
}
// A Windows absolute root is still absolute — the guard must not be POSIX-only.
await runWorkflow({ args: { ...PREPARED, pluginRoot: 'C:\\plugin' } })

// B3. corpusSha256 is the pristine-corpus gate AND is interpolated into the publish bash
// command, so it is shape-checked and quoted.
for (const bad of ['abc', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'a'.repeat(64) + ' ; rm -rf /', 'g'.repeat(64)]) {
  await assert.rejects(
    () => runWorkflow({ args: { ...PREPARED, corpusSha256: bad } }),
    /corpusSha256/,
    `corpusSha256 '${bad.slice(0, 20)}…' must be rejected`,
  )
}
{
  const { calls } = await runWorkflow()
  assert.ok(
    promptFor(calls, 'artifacts:publish').includes('--expected-hash "' + PREPARED.corpusSha256 + '"'),
    'corpusSha256 must be QUOTED at its bash interpolation site',
  )
}

// B4. hunters is REQUIRED — absent or empty is a hard fail. Silently substituting all 14 would
// mask a launcher that dropped the user's selection (and cost 14 agents' tokens unasked).
for (const bad of [undefined, null, [], '', 'everything', {}, 0]) {
  const args = { ...PREPARED, hunters: bad }
  if (bad === undefined) delete args.hunters
  await assert.rejects(
    () => runWorkflow({ args }),
    err => {
      assert.match(err.message, /hunters/, err.message)
      assert.strictEqual(err.calls.length, 0, 'the hunters guard must fire before any agent is dispatched')
      return true
    },
    `hunters=${JSON.stringify(bad) ?? 'undefined'} must be rejected, never defaulted to all 14`,
  )
}
await assert.rejects(
  () => runWorkflow({ args: { ...PREPARED, hunters: ['sqli', 'nope'] } }),
  /unknown Hunter class/i,
  'unknown hunter classes are rejected',
)
{
  // 'all' is the ONLY way to get the full sweep, and it really does dispatch all 14.
  const { calls } = await runWorkflow({ args: { ...PREPARED, hunters: 'all' } })
  const hunted = calls.filter(c => c.label.startsWith('hunt:')).map(c => c.label.slice(5))
  assert.deepStrictEqual(hunted, ALL, "hunters:'all' runs exactly the 14 source hunters")
}
{
  const { calls } = await runWorkflow({ args: { ...PREPARED, hunters: ['sqli'] } })
  assert.deepStrictEqual(calls.filter(c => c.label.startsWith('hunt:')).map(c => c.label), ['hunt:sqli'],
    'a one-hunter selection dispatches exactly one hunter')
}

// B5. A dead hunter is retried EXACTLY once and then aborts the run. A silently dropped hunter
// would emit a CLEAN report on partial coverage — a false all-clear.
for (const death of [null, new Error('connection dropped')]) {
  const err = await runWorkflow({ reply: ({ label }) => (label === 'hunt:sqli' ? death : undefined) })
    .then(() => null, e => e)
  assert.ok(err, 'an always-dead hunter must abort the run, not be dropped')
  assert.match(err.message, /still failed after retry|partial coverage/i, err.message)
  assert.strictEqual(callsFor(err.calls, 'hunt:sqli').length, 2,
    'a dead hunter is retried exactly once (2 attempts) — no more, no fewer')
  assert.strictEqual(callsFor(err.calls, 'artifacts:publish').length, 0,
    'the run must not reach publication after an incomplete hunt')
}
// A hunter that returns a truthy value WITHOUT the results file it was told to write has not
// covered its class (e.g. it could not read its SKILL.md) — that is a death, not a success.
for (const useless of [true, 'I could not find the skill', {}, { resultsFile: '' }, { resultsFile: '/work/sast/xss-results.md' }]) {
  const err = await runWorkflow({ reply: ({ label }) => (label === 'hunt:sqli' ? useless : undefined) })
    .then(() => null, e => e)
  assert.ok(err, `hunt reply ${JSON.stringify(useless)} must not count as coverage`)
  assert.match(err.message, /still failed after retry|partial coverage/i, err.message)
}
// One transient death is survivable: the retry succeeds and the run completes.
{
  const { result, calls } = await runWorkflow({
    reply: ({ label, attempt }) => (label === 'hunt:sqli' && attempt === 1 ? null : undefined),
  })
  assert.strictEqual(callsFor(calls, 'hunt:sqli').length, 2)
  assert.strictEqual(result.hunterCount, 2, 'a hunter that dies once and then succeeds still counts')
}

// B6. robustAgent (every single-agent stage) has the same bounded retry + fail-loud contract.
{
  const err = await runWorkflow({ reply: ({ label }) => (label === 'recon:map' ? null : undefined) })
    .then(() => null, e => e)
  assert.ok(err, 'a dead single-agent stage must abort the run')
  assert.match(err.message, /failed after retry/, err.message)
  assert.strictEqual(callsFor(err.calls, 'recon:map').length, 2,
    'a dead stage agent is retried exactly once (2 attempts)')
  const { calls } = await runWorkflow({
    reply: ({ label, attempt }) => (label === 'recon:map' && attempt === 1 ? null : undefined),
  })
  assert.strictEqual(callsFor(calls, 'recon:map').length, 2, 'a stage that dies once is retried and continues')
}

// B7. A dead Challenge batch aborts too: its findings would reach Dedupe un-annotated and drop
// silently, since only DEFECT-tagged findings carry forward.
{
  const finding = { class: 'sqli', file: 'app/db.py', line: 12, title: 'concatenated query' }
  const err = await runWorkflow({
    reply: ({ label }) => {
      if (label === 'collect') return { findings: [finding] }
      if (label === 'challenge:sqli(1)') return null
      return undefined
    },
  }).then(() => null, e => e)
  assert.ok(err, 'an always-dead challenger must abort the run')
  assert.match(err.message, /Challenger\(s\) failed after retry/, err.message)
  assert.strictEqual(callsFor(err.calls, 'challenge:sqli(1)').length, 2,
    'a dead challenger is retried exactly once (2 attempts)')
}

// B8. The reconcile guard runs UNCONDITIONALLY — including when collect() reports zero findings,
// which is exactly the case an early return would skip (and collect() under-reporting is one of
// the two failures the guard exists to catch).
for (const findings of [[], [{ class: 'sqli', file: 'a.py', line: 1, title: 't' }]]) {
  const { calls } = await runWorkflow({ reply: ({ label }) => (label === 'collect' ? { findings } : undefined) })
  assert.strictEqual(callsFor(calls, 'reconcile-guard').length, 1,
    `reconcile guard must run for a ${findings.length}-finding Challenge round`)
}

// B9. The launchToken gate. A full audit fans out many agents and costs real money, so the
// workflow must refuse to start unless the run skill launched it — the skill is the only thing
// that inspects, confirms with the operator, and prepares. Asserted by behaviour: the previous
// text assertion matched the message string INSIDE the block, so deleting the whole gate left it
// green.
for (const bad of [undefined, null, '', '   ', 'nope', 'secaudit', 42, true, {}]) {
  const args = { ...PREPARED, launchToken: bad }
  if (bad === undefined) delete args.launchToken
  await assert.rejects(
    () => runWorkflow({ args }),
    err => {
      assert.match(err.message, /launchToken/, `rejection must name launchToken, got: ${err.message}`)
      assert.strictEqual(err.calls.length, 0, 'no agent may be dispatched without a valid launchToken')
      return true
    },
    `launchToken=${JSON.stringify(bad) ?? 'undefined'} must not start a full audit`,
  )
}

// B10. The deliverables post-condition. `publish` reporting success is not evidence the files
// exist; verify-artifacts re-checks them on disk and the workflow must abort when any is missing.
// Same dead-block problem as B9: the old assertion matched the message inside the `if`.
{
  const err = await runWorkflow({
    reply: ({ label }) => (label === 'artifacts:verify' ? { missing: ['trace.md', 'work/sast/report-data.json'] } : undefined),
  }).then(() => null, e => e)
  assert.ok(err, 'a run whose deliverables are missing must not report success')
  assert.match(err.message, /trace\.md, work\/sast\/report-data\.json/, err.message)
  // And the happy path still completes, so the assertion above is not just "always throws".
  const { result } = await runWorkflow()
  assert.ok(result.runDir, 'a run with all deliverables present completes')
}

// B11. The reconcile guard's reply must be SHAPED, not merely truthy. `r?.residual || []` let a
// non-conforming reply read as "0 residual", and the run then recorded that every finding
// converted — a false all-clear at the one site whose backstop justifies trusting truthiness
// elsewhere in the pipeline.
for (const garbage of ['done', 42, true, {}, { residual: 'none' }, { residual: {} }, []]) {
  const err = await runWorkflow({
    reply: ({ label }) => (label === 'reconcile-guard' ? garbage : undefined),
  }).then(() => null, e => e)
  assert.ok(err, `a reconcile-guard reply of ${JSON.stringify(garbage)} must abort, not read as 0 residual`)
  assert.match(err.message, /reconcile-guard returned no usable/, err.message)
  assert.ok(
    !err.notes.some(n => /all findings converted/.test(n)),
    'the run must never record that every finding converted on an unusable guard reply',
  )
}

console.log('PASS validate-workflow behavioural checks')

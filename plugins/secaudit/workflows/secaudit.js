export const meta = {
  name: 'secaudit',
  description: 'Deterministic Glasswing security code-audit over the secaudit SKILL.md skills (Recon → Hunt → Challenge → [Blindspot Sweep] → Dedupe → Trace → Generate Artifacts). Source-hunt only; SCA is a separate standalone skill.',
  phases: [
    { title: 'Recon' },
    { title: 'Hunt' },
    { title: 'Challenge' },
    { title: 'Blindspot Sweep' },
    { title: 'Dedupe' },
    { title: 'Trace' },
    { title: 'Generate Artifacts' },
  ],
}

// ---- inputs: an object { target, hunters, blindspotSweep, traceBatch }, OR a string that is
// either a bare repo path or a JSON-encoded object (some harnesses stringify the args payload). ----
function parseArgs(a) {
  if (a == null) return {}
  if (typeof a !== 'string') return a
  const s = a.trim()
  if (s.startsWith('{') || s.startsWith('[')) {
    try { return JSON.parse(s) } catch { /* not JSON — treat as a bare path below */ }
  }
  return { target: a }
}
const opts = parseArgs(args)
// Full-audit gate (spec review decision 1): only the secaudit:run skill may start this
// workflow. Installation must never authorize an implicit full pipeline.
if (opts.launchToken !== 'secaudit:run') {
  throw new Error('secaudit: refusing to start — launch via the secaudit:run skill, which inspects, confirms, and prepares the run first (missing/invalid launchToken)')
}
const target = opts.target
if (!target) throw new Error('secaudit: a target repo path is required (args string or args.target)')

// Preparation is the run skill's job (deterministic runtime `prepare`); the workflow only
// consumes its results. All SEVEN are required — a missing one means the launcher skipped
// prepare, and Generate Artifacts would starve at the end of the run. Each is validated for
// shape, not just presence: '' and a wrong type are as broken as absent (every one of these is
// interpolated into an agent prompt or a bash command), and the workflow sandbox has no
// filesystem, shell or env access, so this is the only place they can be checked.
for (const [key, kind] of [
  ['work', 'string'], ['runDir', 'string'], ['runId', 'string'], ['coverage', 'object'],
  ['corpusSha256', 'string'], ['generatedDate', 'string'], ['pluginRoot', 'string'],
]) {
  const value = opts[key]
  const bad = kind === 'string'
    ? typeof value !== 'string' || value.trim() === ''
    : value === null || typeof value !== 'object' || Array.isArray(value)
  if (bad) {
    throw new Error("secaudit: prepared-run input '" + key + "' must be a non-empty " + kind +
      " (got " + (value === undefined ? 'nothing' : JSON.stringify(value)) + ") — the run skill must" +
      " call `secaudit-runtime.mjs prepare` and pass its JSON through, adding pluginRoot itself")
  }
}
const { work, runDir, runId, coverage, corpusSha256, generatedDate } = opts
const pluginRoot = opts.pluginRoot
// corpusSha256 is interpolated into the publish bash command, and is the pristine-corpus
// gate — a malformed value either breaks the command or weakens the check.
if (!/^[0-9a-f]{64}$/.test(corpusSha256)) {
  throw new Error("secaudit: prepared-run input 'corpusSha256' must be a 64-char lowercase hex digest — got '" + corpusSha256 + "'")
}
// pluginRoot prefixes every skill path in every agent prompt. A relative path resolves against
// whatever cwd each agent happens to have, and `${CLAUDE_PLUGIN_ROOT}` is only expanded in skill
// and agent CONTENT — never in a workflow script — so an unexpanded placeholder really does arrive.
if (pluginRoot.includes('${')) {
  throw new Error("secaudit: prepared-run input 'pluginRoot' still contains an unexpanded placeholder ('" + pluginRoot + "') — the run skill must resolve it to a real absolute path before launching")
}
if (!pluginRoot.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(pluginRoot)) {
  throw new Error("secaudit: prepared-run input 'pluginRoot' must be an absolute path — got '" + pluginRoot + "'")
}
// Bundled resources resolve from the installed plugin, never from the current directory —
// the workflow sandbox has no filesystem or env access, so the run skill passes this in.
const SKILLS = pluginRoot + '/skills'

// ---- the 14 source hunters (SCA is intentionally NOT here — it is a standalone skill) ----
const ALL_HUNTERS = [
  'businesslogic', 'fileupload', 'graphql', 'hardcodedsecrets', 'idor', 'jwt',
  'missingauth', 'pathtraversal', 'rce', 'sqli', 'ssrf', 'ssti', 'xss', 'xxe',
]
for (const retired of ['detectors', 'loops', 'validateBatch']) {
  if (Object.hasOwn(opts, retired)) {
    const replacement = {
      detectors: 'hunters',
      loops: 'blindspotSweep',
      validateBatch: 'traceBatch',
    }[retired]
    throw new Error("secaudit: retired input '" + retired + "'; use '" + replacement + "'")
  }
}
// (retired: detectors → hunters, loops → blindspotSweep, validateBatch → traceBatch)

// ---- cost controls: the lever is AGENT COUNT (tokens). Hunter selection is done by the
// launcher (AskUserQuestion) and passed in; the workflow only validates and runs it.
// hunters is REQUIRED: absent/empty is a hard fail — we refuse to silently run all 14, which
// would mask a launcher that dropped the selection. Pass the literal 'all' to run the full sweep. ----
if (opts.hunters == null || (Array.isArray(opts.hunters) && opts.hunters.length === 0)) {
  throw new Error("secaudit: 'hunters' is required — pass a class array or 'all'")
}
const requestedHunters = opts.hunters === 'all' ? ALL_HUNTERS : opts.hunters
if (!Array.isArray(requestedHunters)) {
  throw new Error("secaudit: 'hunters' must be a class array or 'all'")
}
const unknownHunters = requestedHunters.filter(name => !ALL_HUNTERS.includes(name))
if (unknownHunters.length) {
  throw new Error('secaudit: unknown Hunter class(es): ' + unknownHunters.join(', '))
}
const HUNTERS = ALL_HUNTERS.filter(name => requestedHunters.includes(name))
if (opts.blindspotSweep != null && typeof opts.blindspotSweep !== 'boolean') {
  throw new Error("secaudit: 'blindspotSweep' must be boolean")
}
if (opts.traceBatch != null && (!Number.isInteger(opts.traceBatch) || opts.traceBatch < 1)) {
  throw new Error("secaudit: 'traceBatch' must be a positive integer")
}
const traceBatch = opts.traceBatch ?? 5
// Blindspot Sweep OFF unless explicitly enabled — it is one extra full hunt+challenge round.
const blindspotSweep = opts.blindspotSweep === true

// ---- schemas: control-flow plumbing only, never a verdict ----
const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['class', 'file', 'line', 'title'],
        properties: {
          class: { type: 'string' }, file: { type: 'string' },
          line: { type: ['integer', 'string'] }, title: { type: 'string' },
        },
      },
    },
  },
}
// A hunter must name the results file it wrote — the only evidence the sandbox can check that the
// hunter actually ran its skill rather than returning a truthy narration (see huntRound).
const HUNT_RESULT_SCHEMA = {
  type: 'object', required: ['resultsFile'],
  properties: { resultsFile: { type: 'string' } },
}
const TASKS_SCHEMA = {
  type: 'object', required: ['hasTasks', 'tasks'],
  properties: { hasTasks: { type: 'boolean' }, tasks: { type: 'string' } },
}
// Trace batch agents return verdicts (read-only); a single merge agent writes them into deduped.md.
const TRACE_VERDICTS_SCHEMA = {
  type: 'object', required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string' },       // the file:line key handed to the agent
          verdict: { type: 'string', enum: ['REACHABLE', 'UNREACHABLE', 'NEEDS-PROOF'] },
          evidence: { type: 'string' }, // one-line path (REACHABLE) or dynamic test (NEEDS-PROOF)
        },
      },
    },
  },
}

// ---- ledger: lines echoed live AND written into run-ledger.json / trace.md by
// Generate Artifacts' Publish step ----
const ledger = []
function note(m) { ledger.push(m); log(m) }

// ---- S2: retry a single CRITICAL stage agent once on death (null return / throw), then fail
// loud. Same rationale as the Hunt retry — a silently-dead artifact stage (recon/collect/dedupe/
// trace/report) would let the pipeline march on with a missing input and emit a misleading
// report. Bounded to 2 attempts; resume re-runs from the failed stage. ----
async function robustAgent(prompt, opts) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await agent(prompt, opts)
      if (r) return r
    } catch { /* fall through */ }
    if (attempt < 2) note(`${opts.label}: died — retrying once`)
  }
  throw new Error(`secaudit: stage '${opts.label}' failed after retry — likely a transient API/connection drop. Refusing to continue on a missing artifact; resume to re-run from this stage.`)
}

// ---- Stage 1: Recon (preparation already done by the run skill via secaudit-runtime.mjs
// prepare; Recon is the architecture-mapping operation) ----
phase('Recon')
note('Recon / Prepare: ' + target + ' run ' + runId + ' — hunters=' + HUNTERS.length +
  ' — traceBatch=' + traceBatch)
await robustAgent(
  `You are the Map operation inside Recon. Read ${SKILLS}/sast-analysis/SKILL.md and map ` + work +
  ' into ' + work + '/sast/architecture.md with ## Hunt Tasks.',
  { label: 'recon:map', phase: 'Recon' },
)
note('Recon / Map: architecture.md written')

// ---- helper: one Hunt round. scope=null → full first round; scope=string → re-hunt focused.
// A hunter that dies mid-flight (transient API/connection drop) returns null; if we silently
// dropped it, an all-dead round would still march on and emit a CLEAN report on ZERO coverage
// — a false all-clear. So: retry the dead hunters ONCE, then throw if any still failed.
// ponytail: bounded retry (2 attempts), no unbounded loop; resume re-runs only the dead ones. ----
async function huntRound(scope, tag, roundNum) {
  const scopeLine = scope
    ? `This is a RE-HUNT scoped to these tasks (round ${roundNum}). For each results file you add to: read the existing file, then append ONE new \`## Round ${roundNum}\` findings section using an edit/append — do NOT rewrite, reorder, or re-emit the Executive Summary, any existing \`## Round\` section, or the \`## Coverage\` block. Only new findings for this round go in the new section:\n${scope}`
    : 'This is the first full hunt. Write the results file fresh with a `## Round 1` section.'
  const run = async cls =>
    agent(
      `You are the Hunt stage of the secaudit pipeline. Your results file feeds later Challenge (adversarial re-check) and Trace (reachability) stages — report candidate findings with evidence, tag each \`### [FINDING] <title> (<file>:<line>)\` with a \`**Confidence:** high|medium|low\` line, and do NOT judge reachability or drop uncertain ones (downstream stages do that). Use ${work}/sast/architecture.md for context. Run the skill's method inline.\n\n` +
      `Hunter: "${cls}". Read ${SKILLS}/sast-hunter-${cls}/SKILL.md and execute it against ${work}. Write ${work}/sast/${cls}-results.md ending in a ## Coverage section (Covered / Not covered / Shallow). ${scopeLine}\n\nReturn {resultsFile} = the absolute path of the results file you wrote (it must end in "${cls}-results.md"). If you could not read the skill or could not write that file, do not invent a path — fail instead.`,
      { label: `hunt:${cls}${tag}`, phase: 'Hunt', schema: HUNT_RESULT_SCHEMA },
    )
      // A hunter "succeeded" only if it reports the results file it was told to write. `!!r` used
      // to be enough, so a hunter that couldn't read its SKILL.md and returned any truthy value
      // counted as covered — silent partial coverage, i.e. a false all-clear.
      .then(r => ({ cls, ok: typeof r?.resultsFile === 'string' && r.resultsFile.endsWith(`${cls}-results.md`) }))
      .catch(() => ({ cls, ok: false }))

  let pending = HUNTERS
  const done = []
  for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
    if (attempt > 1) note(`Hunt: retrying ${pending.length} dead hunter(s): ${pending.join(', ')}`)
    const res = await parallel(pending.map(cls => () => run(cls)))
    done.push(...res.filter(x => x && x.ok).map(x => x.cls))
    pending = res.filter(x => !x || !x.ok).map(x => x && x.cls).filter(Boolean)
  }
  if (pending.length) {
    throw new Error(`secaudit: ${pending.length}/${HUNTERS.length} hunters still failed after retry (${pending.join(', ')}) — likely a transient API/connection drop. Refusing to emit a report on partial coverage (that would be a false all-clear). Resume the run to re-hunt only the dead hunters.`)
  }
  return done.length
}

// Reconcile guard: after Challenge, no finding may still carry an un-converted hunt tag.
// A dropped/un-converted finding would silently vanish at Dedupe (only [DEFECT] carries
// forward) — the same false-clean class the hunt/challenge retries guard against.
async function reconcileGuard() {
  const r = await robustAgent(
    `Read every ${work}/sast/*-results.md. A finding is UN-CONVERTED if its heading is ` +
    `\`### [FINDING]\` (or any legacy tag: [VULNERABLE], [LIKELY VULNERABLE], [NEEDS MANUAL REVIEW], ` +
    `[NOT VULNERABLE], [EXPLOITABLE], [LIKELY EXPLOITABLE], [NOT EXPLOITABLE]) and it has NO ` +
    `\`**Challenge:**\` line before the next \`###\` heading or end of file. Return ` +
    `{residual:[{file,heading}]} listing every un-converted finding. Enumeration only — do not judge.`,
    { label: 'reconcile-guard', phase: 'Challenge', schema: {
      type: 'object', required: ['residual'],
      properties: { residual: { type: 'array', items: {
        type: 'object', required: ['file','heading'],
        properties: { file: { type: 'string' }, heading: { type: 'string' } } } } },
    } },
  )
  // `r?.residual || []` would let a truthy but non-conforming reply read as "0 residual", and the
  // ledger would then record that every finding converted. That is the same misplaced trust taken
  // away from hunters above — and this guard is the backstop that justifies leaving truthiness
  // alone elsewhere, so it is the one place that must not rely on it.
  if (!r || typeof r !== 'object' || !Array.isArray(r.residual)) {
    throw new Error('secaudit: reconcile-guard returned no usable {residual:[{file,heading}]} — ' +
      'refusing to record that every finding converted. Got: ' + JSON.stringify(r) +
      '. Resume to re-run the guard.')
  }
  const residual = r.residual
  if (residual.length) {
    throw new Error(`secaudit: ${residual.length} finding(s) reached Dedupe un-converted by Challenge ` +
      `(would silently drop — only [DEFECT] carries forward). Offending: ` +
      residual.map(x => `${x.file} ${x.heading}`).join('; ') + `. Resume to re-challenge.`)
  }
  note(`Reconcile: all findings converted (0 residual)`)
}

// ---- helper: collect un-challenged findings, fan out ONE Challenge agent per HUNTER.
// Each challenger cold-reads only its own hunter's findings — a 1:1 hunter→challenger pairing,
// so agent count per round is exactly the number of hunters that produced new findings. ----
async function challengeNewFindings() {
  const collected = await robustAgent(
    `Read every ${work}/sast/*-results.md. Return {findings:[{class,file,line,title}]} listing ONLY findings that do NOT yet carry a "**Challenge:**" annotation line (i.e. not yet challenged). Lift file:line out of body bullets into the record if the heading lacks it. "class" is the results-file stem (e.g. "sqli"). This is enumeration only — do not judge.`,
    { label: 'collect', phase: 'Challenge', schema: FINDINGS_SCHEMA },
  )
  const findings = collected?.findings || []
  // Return value is the CHALLENGER BATCH COUNT (one challenger per hunter with findings),
  // not the finding count — Generate Artifacts' run-ledger records the final round's batch
  // count, and 0 batches for a 0-finding round is the correct value either way. An empty
  // findings list yields empty batches → the challenger loop below no-ops, and the reconcile
  // guard at the end still runs (unconditional backstop against collect() under-reporting).
  const byClass = new Map()
  for (const f of findings) byClass.set(f.class, [...(byClass.get(f.class) || []), f])
  const batches = [...byClass.values()]
  // A dead Challenge agent would leave its findings un-annotated → Dedupe (which carries only
  // DEFECT-tagged findings forward) drops them silently — the same false-clean failure the Hunt
  // stage guards against. So retry dead agents once, then fail loud. ponytail: bounded to 2.
  let pending = batches.map(batch => ({ batch, cls: batch[0].class }))
  for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
    if (attempt > 1) note(`Challenge: retrying ${pending.length} dead challenger(s): ${pending.map(p => p.cls).join(', ')}`)
    const res = await parallel(pending.map(({ batch, cls }) => () => agent(
      `Read ${SKILLS}/secaudit-challenge/SKILL.md. Challenge EACH of the following ${batch.length} finding(s), re-reading the cited source cold for each and annotating that finding in place (DEFECT / NOT-A-DEFECT / UNSURE + a **Challenge:** line). Judge each independently. Touch ONLY these findings:\n` +
        batch.map((f, i) => `${i + 1}. "${f.title}" — in ${work}/sast/${f.class}-results.md at ${f.file}:${f.line}`).join('\n'),
      { label: `challenge:${cls}(${batch.length})`, phase: 'Challenge' },
    ).then(r => ({ batch, cls, ok: !!r })).catch(() => ({ batch, cls, ok: false }))))
    pending = res.filter(x => !x || !x.ok).map(x => x && { batch: x.batch, cls: x.cls }).filter(Boolean)
  }
  if (pending.length) {
    throw new Error(`secaudit: ${pending.length}/${batches.length} Challenger(s) failed after retry (${pending.map(p => p.cls).join(', ')}) — those findings would silently drop from Dedupe (only DEFECT-tagged findings carry forward). Resume to re-challenge.`)
  }
  note(batches.length
    ? `Challenge: ${findings.length} findings across ${batches.length} challenger(s) — one per hunter with findings`
    : 'Challenge: 0 new findings')
  // Guard runs AFTER challengers convert their findings, and unconditionally — an independent
  // backstop against BOTH a dead challenger AND collect() under-reporting zero findings (either
  // would else let an un-converted [FINDING] drop silently at Dedupe, which carries only [DEFECT]).
  await reconcileGuard()
  return batches.length
}

// ---- helper: Trace every DEFECT record in deduped.md that lacks a **Trace:** line.
// Reachability tracing is the deepest per-record work in the pipeline; running it as ONE agent
// over all DEFECTs collapses each into a shallow slice at scale. So batch it like Challenge
// (capped at hunter count). Race-safe two-phase: batch agents trace READ-ONLY and RETURN
// verdicts (they must NOT edit the single shared deduped.md concurrently — that clobbers), then
// one merge agent writes all verdicts in. It only traces records still missing a **Trace:**
// line, so a re-run after a resumed stage only re-traces what's new. ----
async function traceDefects() {
  const collected = await robustAgent(
    `Read ${work}/sast/deduped.md. Return {findings:[{class,file,line,title}]} listing ONLY "### [DEFECT]" records that do NOT yet carry a "**Trace:**" line. class = the record's **Class:** value; file/line/title come from the record heading "### [DEFECT] <title> (<file>:<line>)". Enumeration only — do not analyze reachability.`,
    { label: 'trace-collect', phase: 'Trace', schema: FINDINGS_SCHEMA },
  )
  const defects = collected?.findings || []
  if (!defects.length) { note('Trace: 0 untraced DEFECTs'); return 0 }
  const maxAgents = HUNTERS.length
  const batchSize = Math.max(traceBatch, Math.ceil(defects.length / maxAgents))
  const batches = []
  for (let i = 0; i < defects.length; i += batchSize) batches.push(defects.slice(i, i + batchSize))

  // Phase A — parallel, READ-ONLY: each batch traces its records deeply and returns verdicts.
  let pending = batches.map((batch, bi) => ({ batch, bi }))
  const verdicts = []
  for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
    if (attempt > 1) note(`Trace: retrying ${pending.length} dead batch(es)`)
    const res = await parallel(pending.map(({ batch, bi }) => () => agent(
      `Read ${SKILLS}/secaudit-trace/SKILL.md and follow its Method + Verdicts exactly. Use ${work}/sast/architecture.md for the external entry points and read source under ${work} as needed. Trace EACH of the following ${batch.length} DEFECT record(s) INDEPENDENTLY — do not reason across records or let one verdict influence another. Do NOT edit any file. RETURN {verdicts:[{id,verdict,evidence}]}: id = the exact file:line key given below; verdict = REACHABLE | UNREACHABLE | NEEDS-PROOF; evidence = the required one-line 'entry → … → sink' path (REACHABLE), the reason no external path exists (UNREACHABLE), or the exact dynamic test that would settle it (NEEDS-PROOF). Records:\n` +
        batch.map((f, i) => `${i + 1}. key=${f.file}:${f.line} — "${f.title}" (${f.class})`).join('\n'),
      { label: `trace:batch${bi + 1}(${batch.length})`, phase: 'Trace', schema: TRACE_VERDICTS_SCHEMA },
    ).then(r => ({ batch, bi, r })).catch(() => ({ batch, bi, r: null }))))
    for (const x of res) if (x && x.r) verdicts.push(...(x.r.verdicts || []))
    pending = res.filter(x => !x || !x.r).map(x => x && { batch: x.batch, bi: x.bi }).filter(Boolean)
  }
  if (pending.length) {
    throw new Error(`secaudit: ${pending.length}/${batches.length} Trace batch(es) failed after retry — those DEFECTs would go un-traced and mis-bucket in the report. Resume to re-trace.`)
  }

  // Phase B — single writer, race-free: apply all verdicts into deduped.md in one pass.
  await robustAgent(
    `Annotate ${work}/sast/deduped.md IN PLACE. For each verdict below, add exactly ONE line directly under the matching "### [DEFECT]" record whose heading location is "(<id>)": "**Trace:** <verdict> — <evidence>". Match strictly by the id (file:line). Change nothing else. Verdicts:\n` +
      verdicts.map((v, i) => `${i + 1}. id=${v.id} → ${v.verdict} — ${v.evidence}`).join('\n'),
    { label: 'trace-merge', phase: 'Trace' },
  )
  note(`Trace: ${defects.length} DEFECT(s) in ${batches.length} batch agent(s) (batch=${batchSize}, cap=${maxAgents}) + 1 merge`)
  return defects.length
}

// ---- Stage 2 + 3: Hunt, Challenge ----
phase('Hunt')
const nHunt = await huntRound(null, '', 1)
note(`Hunt: ${nHunt} hunters completed`)
phase('Challenge')
let challengeBatchFinal = await challengeNewFindings()

// ---- Stage 4: Blindspot Sweep (optional, one pass) — targets the high-risk areas the first
// Hunt round skipped or only skimmed, using each hunter's own Coverage self-report. Off unless
// explicitly enabled: it is one extra full hunt+challenge round. ----
let blindspotReplayed = false
let replayedHunterCount = 0
if (blindspotSweep) {
  phase('Blindspot Sweep')
  const sweep = await robustAgent(
    `Read ${SKILLS}/secaudit-blindspot-sweep/SKILL.md and write ` +
    work + '/sast/blindspot-tasks.md. Return {hasTasks,tasks}.',
    { label: 'blindspot-sweeper', phase: 'Blindspot Sweep', schema: TASKS_SCHEMA },
  )
  if (sweep.hasTasks) {
    phase('Hunt')
    replayedHunterCount = await huntRound(sweep.tasks, ':blindspot', 2)
    phase('Challenge')
    challengeBatchFinal = await challengeNewFindings()
    blindspotReplayed = true
  }
} else {
  note('Blindspot Sweep: skipped (disabled)')
}

// ---- Stage 5: Dedupe ----
phase('Dedupe')
await robustAgent(
  `Read ${SKILLS}/secaudit-dedupe/SKILL.md and execute it against ${work} → ${work}/sast/deduped.md.`,
  { label: 'dedupe', phase: 'Dedupe' },
)
note('Dedupe: deduped.md written')

// ---- Stage 6: Trace (batched + parallel, capped at hunter count; race-safe read→merge) ----
phase('Trace')
await traceDefects()

// ---- Stage 8: Generate Artifacts (deterministic assembly, render, and publish — replaces
// the old free-form Report + Harvest stages). Three robustAgent operations: the model only
// ASSEMBLES facts into report-data.json (never hand-writes buckets/counts/Markdown/HTML);
// render-report.mjs and publish-artifacts.mjs are deterministic Node CLIs the agent runs via
// bash, mirroring how the old Harvest agent ran bash commands and returned parsed JSON. ----
phase('Generate Artifacts')

const assembled = await robustAgent(
  `You are the Generate operation of secaudit-generate-artifacts. Read ${SKILLS}/secaudit-generate-artifacts/SKILL.md and follow its Generate rules exactly. ` +
  `Inputs: hunters=${JSON.stringify(HUNTERS)}, generatedDate="${generatedDate}", coverage=${JSON.stringify(coverage)}. ` +
  `Assemble ${work}/sast/report-data.json from ${work}/sast/architecture.md, every ${work}/sast/*-results.md, and ${work}/sast/deduped.md, then validate it against report-data.schema.json (via validateReportData from report-contract.mjs) before moving on. Return {reportData} = the absolute path to the written, validated file.`,
  { label: 'artifacts:assemble', phase: 'Generate Artifacts', schema: {
    type: 'object', required: ['reportData'],
    properties: { reportData: { type: 'string' } },
  } },
)
note(`Generate Artifacts / Assemble: ${assembled.reportData} written and schema-validated`)

await robustAgent(
  `Run: node "${SKILLS}/secaudit-generate-artifacts/scripts/render-report.mjs" --data "${assembled.reportData}" --out-md "${work}/sast/final-report.md" --out-html "${work}/sast/final-report.html". If it exits non-zero, throw its stderr verbatim — do not continue past a failed render.`,
  { label: 'artifacts:render', phase: 'Generate Artifacts' },
)
note('Generate Artifacts / Render: final-report.md + final-report.html written')

// run-ledger.json: the ordered stage/operation ledger, the hunter list, whether Blindspot
// Sweep replayed a round, how many hunters that replay covered, and the final Challenge
// round's batch count. publish-artifacts.mjs embeds this verbatim into trace.md.
const runLedger = {
  stages: ledger,
  hunters: HUNTERS,
  blindspotSweep,
  blindspotReplayed,
  replayedHunterCount,
  finalChallengeBatchCount: challengeBatchFinal,
}
const artifactSummary = await robustAgent(
  `First write "${work}/sast/run-ledger.json" with EXACTLY this JSON content (formatting may differ, values must not): ${JSON.stringify(runLedger)}\n` +
  `Then run: node "${SKILLS}/secaudit-generate-artifacts/scripts/publish-artifacts.mjs" --target "${target}" --expected-hash "${corpusSha256}" --work "${work}" --run-dir "${runDir}" --ledger "${work}/sast/run-ledger.json"\n` +
  `This re-verifies the target corpus is still pristine (byte-identical to before the run) before copying anything — if it is not, the command aborts with "corpus not pristine" and throws; do not continue past that. On success it prints one JSON line {confirmed, refuted, manualReview} — parse it and return it exactly.`,
  { label: 'artifacts:publish', phase: 'Generate Artifacts', schema: {
    type: 'object', required: ['confirmed', 'refuted', 'manualReview'],
    properties: {
      confirmed: { type: 'integer' }, refuted: { type: 'integer' }, manualReview: { type: 'integer' },
    },
  } },
)
note(`Generate Artifacts / Publish: ${artifactSummary.confirmed} confirmed / ${artifactSummary.refuted} refuted / ${artifactSummary.manualReview} manual review → ${runDir}/report.md`)

// Fail-loud post-condition on the DELIVERABLES. The publish step above runs inside an LLM agent,
// which can return a plausible {confirmed,refuted,manualReview} even when publish-artifacts.mjs
// threw and wrote nothing (an agent narrating success it never achieved — this masked a real
// render failure once). The workflow sandbox can't stat files itself, so a separate read-only
// agent runs the deterministic verify-artifacts.mjs (which exits non-zero and lists any missing
// or empty file), and we assert its computed `missing` list here in the control plane — an
// independent check with no stake in publish having succeeded.
const verified = await robustAgent(
  `Run: node "${SKILLS}/secaudit-generate-artifacts/scripts/verify-artifacts.mjs" --run-dir "${runDir}"\n` +
  `It prints one JSON line {sizes, missing}: sizes are the byte sizes of report.md/report.html/trace.md at ${runDir} (-1 if absent), and missing lists any that are absent or empty. It exits non-zero when missing is non-empty. Return {missing} exactly as printed. Read-only — create or edit nothing.`,
  { label: 'artifacts:verify', phase: 'Generate Artifacts', schema: {
    type: 'object', required: ['missing'],
    properties: { missing: { type: 'array', items: { type: 'string' } } },
  } },
)
if (verified.missing.length) {
  throw new Error(`secaudit: publish reported success but ${verified.missing.join(', ')} missing or empty ` +
    `at ${runDir} — the deterministic publish did not produce the deliverables. Resume to re-generate.`)
}
note('Generate Artifacts / Verify: report.md + report.html + trace.md present on disk')

return {
  runDir,
  confirmed: artifactSummary.confirmed,
  refuted: artifactSummary.refuted,
  manualReview: artifactSummary.manualReview,
  hunterCount: HUNTERS.length,
  blindspotSweep,
  traceBatch,
}

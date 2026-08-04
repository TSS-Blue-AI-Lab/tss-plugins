// Executes the REAL workflows/secaudit.js against stubbed engine globals, so tests can assert
// what it DOES (throws, retries, dispatches) instead of what its source text says. Source-text
// assertions are satisfied by a comment or a renamed-but-equivalent construct; these are not.
//
// The workflow is not an importable module: it ends in a top-level `return`, uses top-level
// `await`, and takes `args`/`log`/`phase`/`agent`/`parallel` from the engine. So it is compiled
// exactly as the engine compiles it — as an async function body.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
export const workflowPath = join(root, 'workflows/secaudit.js')
export const workflowSource = readFileSync(workflowPath, 'utf8')

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const compiled = new AsyncFunction(
  'args', 'log', 'phase', 'agent', 'parallel',
  workflowSource.replace(/^export const meta =/m, 'const meta ='),
)

// A complete, well-formed prepared-run payload — what `secaudit-runtime.mjs prepare` plus the
// run skill's own pluginRoot look like on a good launch.
export const PREPARED = Object.freeze({
  launchToken: 'secaudit:run',
  target: '/corpus',
  hunters: ['sqli', 'xss'],
  work: '/work',
  runDir: '/corpus/.secaudit/runs/run-1',
  runId: 'run-1',
  coverage: { sourceLines: 10, sourceFiles: 2, estimatedSourceTokens: 100 },
  corpusSha256: 'a'.repeat(64),
  generatedDate: '2026-07-30',
  pluginRoot: '/plugin',
})

// The smallest return value each labelled agent's caller actually consumes.
function defaultReply(label) {
  if (label.startsWith('hunt:')) {
    return { resultsFile: '/work/sast/' + label.slice('hunt:'.length).split(':')[0] + '-results.md' }
  }
  if (label === 'collect' || label === 'trace-collect') return { findings: [] }
  if (label === 'reconcile-guard') return { residual: [] }
  if (label === 'blindspot-sweeper') return { hasTasks: false, tasks: '' }
  if (label.startsWith('trace:batch')) return { verdicts: [] }
  if (label === 'artifacts:assemble') return { reportData: '/work/sast/report-data.json' }
  if (label === 'artifacts:publish') return { confirmed: 0, refuted: 0, manualReview: 0 }
  if (label === 'artifacts:verify') return { missing: [] }
  return 'done'
}

/**
 * Runs the workflow. `reply({label, prompt, attempt})` may return:
 *   undefined   → use the default happy-path reply
 *   null        → the agent died (what the engine returns on a dropped agent)
 *   an Error    → the agent threw
 *   anything else → that value
 * Resolves to { result, calls, notes, phases }; rejects with whatever the workflow throws.
 */
export async function runWorkflow({ args = PREPARED, reply = () => undefined } = {}) {
  const calls = []
  const notes = []
  const phases = []
  const agent = async (prompt, opts) => {
    const attempt = calls.filter(c => c.label === opts.label).length + 1
    calls.push({ label: opts.label, phase: opts.phase, prompt, schema: opts.schema })
    const override = await reply({ label: opts.label, prompt, attempt })
    if (override === undefined) return defaultReply(opts.label)
    if (override instanceof Error) throw override
    return override
  }
  const run = compiled(
    args,
    m => notes.push(m),
    p => phases.push(p),
    agent,
    fns => Promise.all(fns.map(f => f())),
  )
  try {
    return { result: await run, calls, notes, phases }
  } catch (err) {
    err.calls = calls
    err.notes = notes
    throw err
  }
}

export function callsFor(calls, label) {
  return calls.filter(c => c.label === label)
}

export function promptFor(calls, label) {
  const call = calls.find(c => c.label === label)
  if (!call) {
    throw new Error(`workflow never dispatched an agent labelled '${label}' (saw: ${calls.map(c => c.label).join(', ') || 'none'})`)
  }
  return call.prompt
}

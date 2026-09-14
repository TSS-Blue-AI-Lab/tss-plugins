import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const book = readFileSync(join(root, 'skills/secaudit-orchestrator/SKILL.md'), 'utf8')

// Plugin-root resolution — the runbook runs bundled scripts, and Codex expands no
// ${CLAUDE_PLUGIN_ROOT} placeholder, so the file must state how to resolve the root itself.
assert.match(book, /PLUGIN_ROOT/, 'runbook resolves a PLUGIN_ROOT value')
assert.ok(!/node skills\//.test(book), 'no bare repo-relative `node skills/...` command survives')
for (const script of ['secaudit-runtime.mjs', 'publish-artifacts.mjs', 'verify-artifacts.mjs']) {
  assert.ok(
    new RegExp(`<PLUGIN_ROOT>/skills/[^"\\s]*${script.replace('.', '\\.')}`).test(book),
    `${script} is invoked plugin-root relative`,
  )
}
// The rendered report is retired: the dashboard is the human view. Asserted gone so a
// reintroduced renderer fails the suite rather than quietly coming back.
assert.ok(!/render-report/.test(book), 'the runbook must not invoke a report renderer')

// Codex adapter structure (spec: "Codex orchestrator structure and required stage
// invariants"). The prose must state the same bounds the workflow enforces in code — an
// adapter that approximates them silently redefines the pipeline.
const stages = ['Recon', 'Hunt', 'Challenge', 'Blindspot Sweep', 'Dedupe', 'Trace', 'Generate Artifacts']
// Scan the `## Stages` section body only, and anchor on its numbered headers. A substring scan
// over the whole file passes on the one-line pipeline summary in the frontmatter `description:`,
// so scrambling the actual stage list would not fail it — the assertion would be decoration.
const stagesAt = book.indexOf('\n## Stages (run in this order)')
assert.ok(stagesAt !== -1, 'runbook has a `## Stages (run in this order)` section')
const afterStages = book.indexOf('\n## ', stagesAt + 1)
const stageBody = book.slice(stagesAt, afterStages === -1 ? book.length : afterStages)
stages.forEach((stage, i) => {
  assert.match(
    stageBody,
    new RegExp(`^${i + 1}\\. \\*\\*${stage}`, 'm'),
    `stage "${stage}" is numbered ${i + 1} in the \`## Stages\` list`,
  )
})
assert.match(book, /retried ONCE|retry once/i, 'single-retry bound stated')
assert.match(book, /single replay|do not replay more than once/i, 'blindspot sweep is a single replay')
assert.match(book, /off by default/i, 'blindspot sweep is off by default')
assert.match(book, /default 5 per subagent/, 'trace batching default stated')
assert.match(book, /one Challenger per Hunter/i, 'challenge fan-out is 1:1 per hunter')
assert.match(book, /corpus not pristine/, 'publication fails closed when the target changed')
assert.match(book, /verify-artifacts\.mjs/, 'independent deliverables verification is part of the runbook')

console.log('validate-orchestrator: OK')

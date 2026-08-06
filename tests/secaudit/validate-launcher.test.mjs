import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const cmd = readFileSync(join(root, 'skills/run/SKILL.md'), 'utf8')

// Launcher asks up front, and does NOT mention SCA/Trivy or the removed profile presets.
assert.match(cmd, /AskUserQuestion/, 'launcher asks the user up front via AskUserQuestion')
assert.match(cmd, /hunters/, 'launcher passes a chosen hunters array')
assert.match(cmd, /hunters:\s*\[/, 'launcher Workflow call passes hunters: as an explicit array')
assert.match(cmd, /traceBatch/, 'launcher documents the traceBatch knob')
assert.match(cmd, /[Bb]lindspot/, 'launcher asks about the blindspot sweep')
assert.ok(!/\bsca\b|trivy/i.test(cmd), 'no SCA/Trivy in the launcher')
assert.ok(!/profile/i.test(cmd), 'no profile presets in the launcher')
assert.ok(!/\bdetectors?\b|\bloops\b|validateBatch/.test(cmd), 'retired detectors/loops/validateBatch terms purged from the launcher')

// Task 8: launcher describes the final pipeline names (Challenge/Challenger,
// Generate Artifacts), not the retired Validate/validator/Harvest stage vocabulary.
assert.match(cmd, /Challenge \(adversarial/, 'launcher describes the Challenge stage')
assert.match(cmd, /Challenger/, 'launcher uses the Challenger role noun')
assert.match(cmd, /Generate Artifacts/, 'launcher mentions the Generate Artifacts stage')
assert.ok(!/\bHarvest\b/.test(cmd), 'retired Harvest stage purged from the launcher')
assert.ok(!/\bGapfill\b|\bFeedback\b/.test(cmd), 'retired Gapfill/Feedback loop vocabulary purged from the launcher')
assert.ok(!/\bvalidators?\b/i.test(cmd), 'retired validator role noun purged from the launcher')

// Hunter discoverability: AskUserQuestion caps at 4 options, so the full 14-class list must be
// spelled out in the hunter question TEXT — the user must never have to guess valid class names.
assert.match(cmd, /question text MUST (list|include)/i, 'hunter question text must list the available classes')
assert.match(cmd, /businesslogic[\s\S]*idor[\s\S]*missingauth[\s\S]*ssti,\s*xss,\s*xxe/,
  'full 14-class list shown in the detector question text so the user knows what is available')

// Plan 2: explicit-only entry point + handshake + Node preflight (spec review decisions 1, 2).
assert.match(cmd, /disable-model-invocation:\s*true/, 'run skill is explicit-only in Claude')
assert.match(cmd, /launchToken/, 'launcher passes the workflow handshake token')
assert.match(cmd, /node --version|Node\.js 22/i, 'launcher preflights the Node prerequisite')
assert.match(cmd, /secaudit-runtime\.mjs"? inspect/, 'sniff is inspect-driven, not ad hoc find/wc')
assert.match(cmd, /secaudit-runtime\.mjs"? prepare/, 'workspace comes from prepare, not improvised')
// A private client identifier was checked here too; see forbidden-references.test.mjs for why a
// public test does not enumerate it.
assert.ok(!/eval\//.test(cmd), 'no corpus/eval paths in the packaged launcher')

const rb = readFileSync(join(root, 'skills/secaudit-orchestrator/SKILL.md'), 'utf8')
// Orchestrator parity: no SCA/Trivy, loops described as optional/off-by-default.
assert.ok(!/\bsca\b|trivy/i.test(rb), 'no SCA/Trivy in the orchestrator runbook')
// Task 7: Feedback/Gapfill loop vocabulary retired in favor of a single optional
// Blindspot Sweep replay — the orchestrator no longer says "loop" at all.
assert.match(rb, /replay|blindspot sweep/i, 'orchestrator mentions the blindspot-sweep replay')
assert.match(rb, /off by default|optional|only if|opt-in|skip/i, 'orchestrator marks the replay off-by-default')
assert.ok(!/profile/i.test(rb), 'no profile presets in the orchestrator runbook')
// Task 8: orchestrator uses the final Hunter/Challenger vocabulary throughout,
// not the retired detector/validator/Harvest names.
assert.ok(!/\bdetectors?\b/i.test(rb), 'no retired detector role noun in the orchestrator runbook')
assert.ok(!/\bHarvest\b/.test(rb), 'retired Harvest stage purged from the orchestrator runbook')

// Plugin-root resolution: installed, the plugin is NOT inside the audit target and the
// current directory is not the checkout root. Bare `skills/...` paths would break.
assert.match(cmd, /PLUGIN_ROOT/, 'launcher resolves a PLUGIN_ROOT value')
assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/, 'launcher names the Claude Code substitution')
assert.match(
  cmd,
  /node "<PLUGIN_ROOT>\/skills\/run\/scripts\/secaudit-runtime\.mjs" inspect/,
  'inspect command is plugin-root relative and quoted',
)
assert.match(
  cmd,
  /node "<PLUGIN_ROOT>\/skills\/run\/scripts\/secaudit-runtime\.mjs" prepare/,
  'prepare command is plugin-root relative and quoted',
)
assert.ok(
  !/node skills\//.test(cmd),
  'no bare repo-relative `node skills/...` command survives in the launcher',
)
assert.match(cmd, /pluginRoot:\s*"<PLUGIN_ROOT>"/, 'launcher passes pluginRoot into the workflow')
assert.match(cmd, /name:\s*"secaudit:secaudit"/, 'launcher calls the namespaced plugin workflow')

console.log('PASS validate-launcher checks')

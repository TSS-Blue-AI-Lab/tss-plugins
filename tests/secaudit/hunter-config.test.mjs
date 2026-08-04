import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const workflow = readFileSync(join(root, 'workflows/secaudit.js'), 'utf8')
const launcher = readFileSync(join(root, 'skills/run/SKILL.md'), 'utf8')

assert.match(workflow, /const ALL_HUNTERS\s*=/)
assert.match(workflow, /opts\.hunters/)
assert.match(workflow, /unknown Hunter class/i)
assert.match(workflow, /const traceBatch\s*=/)
assert.ok(!/opts\.detectors|ALL_DETECTORS|\bDETECTORS\b/.test(workflow))
assert.ok(!/phase\(\s*['"]Setup['"]\s*\)/.test(workflow))
assert.match(workflow, /label:\s*['"]recon:map['"]/)
assert.match(launcher, /hunters:\s*\[/)
assert.match(launcher, /traceBatch/)
assert.ok(!/\bdetectors?\b|\bloops\b|validateBatch/.test(launcher))
for (const retired of ['detectors', 'loops', 'validateBatch']) {
  assert.match(workflow, new RegExp("retired input.*" + retired, 's'))
}
const firstInputGuard = workflow.indexOf("for (const retired of ['detectors'")
const firstAgent = workflow.indexOf("label: 'recon:map'")
assert.ok(firstInputGuard > -1 && firstInputGuard < firstAgent,
  'retired inputs must fail before any agent is dispatched')
console.log('PASS hunter-config')

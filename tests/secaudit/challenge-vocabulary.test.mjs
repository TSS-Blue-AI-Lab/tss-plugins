import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const src = readFileSync(join(root, 'skills/secaudit-challenge/SKILL.md'), 'utf8')

assert.ok(src.includes('name: secaudit-challenge'))
assert.ok(src.includes('[FINDING]'))
assert.ok(src.includes('**Challenge:**'))
assert.ok(!src.includes('**Validate:**'))
for (const verdict of ['[DEFECT]', '[NOT-A-DEFECT]', '[UNSURE]']) {
  assert.ok(src.includes(verdict), 'missing verdict ' + verdict)
}
assert.match(src, /###\s*\[FINDING\][\s\S]*###\s*\[DEFECT\]/)
console.log('PASS challenge-vocabulary')

// Shipped plugin files must never reference dev-only paths: a consumer's install contains
// only plugins/secaudit/**, so any such reference is a broken pointer by construction.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const FORBIDDEN = ['.claude/skills', '.agents/skills', '.claude/commands', '.claude/workflows', '.secaudit-local/', '<private-client-identifier>']

const walk = dir => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const offenders = []
for (const file of walk(pluginRoot)) {
  if (!/\.(md|mjs|js|json|yaml|yml)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const ref of FORBIDDEN) {
    if (text.includes(ref)) offenders.push(`${file}: ${ref}`)
  }
}
assert.deepStrictEqual(offenders, [], `forbidden references in shipped files:\n${offenders.join('\n')}`)
console.log('forbidden-references: ok')

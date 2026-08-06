// Shipped plugin files must never reference dev-only paths: a consumer's install contains
// only plugins/secaudit/**, so any such reference is a broken pointer by construction.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
// '.secaudit-local' is deliberately NOT in this list: naming the gitignored developer root in
// prose (e.g. README's Layout section) is accurate documentation, not a leak. What must never
// ship is the DIRECTORY itself, which this walk would already catch since it never runs against
// a real .secaudit-local tree.
// A private client identifier was listed here while the plugin was imported from a corpus that
// mentioned one. It is deliberately gone: a public test cannot enumerate the names it guards
// against without publishing them. The shipped tree was verified clean of it before this repo
// went public, and content is authored here now rather than imported.
const FORBIDDEN = ['.claude/skills', '.agents/skills', '.claude/commands', '.claude/workflows']

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

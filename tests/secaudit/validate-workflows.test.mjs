import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This repo has CI only — no release workflow. Release packaging (zips, GitHub Releases) is
// machinery this repo deliberately dropped; it stayed behind in the dev repo. So there is no
// release.yml here and never will be; only ci.yml is validated.
//
// CI workflow config is repo infrastructure, not plugin content: it lives at the repo root
// (created by Task 6), not inside plugins/secaudit which only ships what installs to users.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (name) => readFileSync(join(repoRoot, '.github/workflows', name), 'utf8')
const ci = read('ci.yml')

// Every `run:` script body, inline or block scalar. No YAML parser is available to this suite,
// so slice by indentation: a block scalar's body is every following line indented deeper than
// the `run:` key itself (blank lines belong to the block).
function runBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:[ \t]*(.*)$/.exec(lines[i])
    if (!m) continue
    const [, indent, inline] = m
    const body = [inline]
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') { body.push(''); continue }
      const deeper = /^\s*/.exec(lines[j])[0].length > indent.length
      if (!deeper) break
      body.push(lines[j])
    }
    blocks.push({ line: i + 1, body: body.join('\n') })
  }
  return blocks
}

for (const [name, text] of [['ci.yml', ci]]) {
  // Supply-chain pinning: a moving tag ref is a third party's write access to our CI.
  const uses = text.match(/uses: [^\s]+/g) || []
  assert.ok(uses.length > 0, `${name} uses at least one action`)
  uses.forEach((u) => {
    assert.match(u, /@[0-9a-f]{40}$/, `${name}: "${u}" is pinned to a full commit SHA`)
  })
  assert.ok(!/<[A-Z_]+_SHA>/.test(text), `${name} has no unresolved SHA placeholder`)

  // Default token scope is read-only; any write is opted into per job, visibly.
  assert.match(text, /^permissions:\n  contents: read$/m, `${name} is read-only by default`)

  // Expression injection: ${{ }} is substituted into the script text before bash parses it, so
  // a value carrying a quote or `$(` becomes code. Values reach scripts through env only.
  const blocks = runBlocks(text)
  assert.ok(blocks.length > 0, `${name} has run: steps to check`)
  blocks.forEach(({ line, body }) => {
    assert.ok(
      !/\$\{\{/.test(body),
      `${name}:${line}: run: body interpolates \${{ }} — pass the value through env: instead`,
    )
  })

  // Windows runners default to PowerShell; an unpinned shell silently changes the language.
  assert.strictEqual(
    (text.match(/^\s*shell: bash$/gm) || []).length,
    blocks.length,
    `${name}: every one of its ${blocks.length} run: steps declares shell: bash`,
  )
}

// The suite must actually run on all supported platforms, not just the cheapest one.
for (const leg of ['macos-latest', 'ubuntu-latest', 'windows-latest']) {
  assert.ok(ci.includes(leg), `ci.yml exercises ${leg}`)
}
assert.match(ci, /fail-fast: false/, 'ci.yml reports every failing leg, not just the first')
assert.ok(!/contents: write/.test(ci), 'ci.yml never grants write access')

console.log('validate-workflows: OK')

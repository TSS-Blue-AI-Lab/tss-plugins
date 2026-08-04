import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// CI/release workflow config is repo infrastructure, not plugin content: it lives at the repo
// root (created by Task 6), not inside plugins/secaudit which only ships what installs to users.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (name) => readFileSync(join(repoRoot, '.github/workflows', name), 'utf8')
const ci = read('ci.yml')
const release = read('release.yml')

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

// Slice a top-level YAML block out by indentation, key line excluded. Same technique as the
// `run:` slicer above and the `policy:` gate in scripts/preflight.mjs — still no YAML parser.
function topBlock(text, key) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => new RegExp(`^${key}:\\s*$`).test(l))
  assert.ok(start !== -1, `expected a top-level ${key}: key`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n')
}

// Split a block into its direct-child mappings: { childKey: body }. Blank and comment lines are
// dropped first so the child level is derived from real keys, not from formatting.
function children(block) {
  const lines = block.split('\n').filter(l => l.trim() !== '' && !/^\s*#/.test(l))
  const indent = l => /^[ \t]*/.exec(l)[0].length
  const base = Math.min(...lines.map(indent))
  const out = {}
  let current = null
  for (const line of lines) {
    const key = indent(line) === base && /^\s*([A-Za-z0-9_.-]+):/.exec(line)
    if (key) { current = key[1]; out[current] = []; continue }
    if (current) out[current].push(line)
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]))
}

for (const [name, text] of [['ci.yml', ci], ['release.yml', release]]) {
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

// Dormancy, asserted PER JOB. A whole-file substring match cannot tell the publish job's gate
// from the build job's: moving `if:` or `contents: write` to build keeps every substring present
// while handing write access to the job that runs on every manual dispatch.
const jobs = children(topBlock(release, 'jobs'))
assert.deepStrictEqual(
  Object.keys(jobs).sort(), ['build', 'publish'],
  'release.yml has exactly a build job and a publish job',
)
// `ref_type` alone is not a gate: a workflow_dispatch can be aimed at an existing tag ref, which
// satisfies ref_type == 'tag'. Publishing requires a real push of that tag.
const DORMANCY_GATE = /^\s*if: github\.event_name == 'push' && github\.ref_type == 'tag'\s*$/m
assert.match(jobs.publish, DORMANCY_GATE, 'the publish job requires BOTH a push event and a tag ref')
assert.match(
  jobs.publish, /^\s*permissions:\n\s+contents: write\s*$/m,
  'the publish job is where contents: write is granted',
)
for (const [job, body] of Object.entries(jobs)) {
  if (job === 'publish') continue
  assert.ok(
    !DORMANCY_GATE.test(body),
    `the ${job} job must not carry the dormancy gate — it belongs to publish, which is the job that publishes`,
  )
  assert.ok(
    !/contents: write/.test(body),
    `the ${job} job must not grant contents: write — publish is the only job that gets it`,
  )
}
assert.strictEqual(
  (release.match(/contents: write/g) || []).length,
  1,
  'release.yml grants write access in exactly one job',
)

// The trigger itself must stay tag-only: a `branches:` entry here would wake the whole workflow
// on ordinary pushes, gate or no gate.
const triggers = children(topBlock(release, 'on'))
assert.ok('push' in triggers, 'release.yml has a push trigger')
assert.match(
  triggers.push, /^\s*tags: \['v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\]$/m,
  'release.yml push trigger fires only on vX.Y.Z tags',
)
assert.ok(
  !/branches:/.test(triggers.push),
  'release.yml push trigger declares no branches: — ordinary branch pushes never reach it',
)
// Never a public release without a human opening it.
assert.match(release, /--draft/, 'release.yml publishes a draft')
assert.match(release, /--prerelease/, 'release.yml publishes a prerelease')

console.log('validate-workflows: OK')

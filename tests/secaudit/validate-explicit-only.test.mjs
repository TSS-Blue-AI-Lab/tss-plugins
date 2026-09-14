import { readFileSync, existsSync, readdirSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasExplicitOnlyPolicy } from './preflight-policy.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')

// The gate predicate is shared with ./preflight-policy.mjs (one rule, two call sites), so it is
// tested here directly against synthetic YAML first — asserting the shipped files with the same
// function that defines "correct" would otherwise be tautological.
assert.ok(
  hasExplicitOnlyPolicy('policy:\n  allow_implicit_invocation: false\n'),
  'accepts the flag as a direct child of the top-level policy: block',
)
assert.ok(
  hasExplicitOnlyPolicy('name: run\npolicy:\n    allow_implicit_invocation: false\n    other: true\ninterface: {}\n'),
  'the direct-child level is derived from the block, not hardcoded to two spaces',
)
assert.ok(
  !hasExplicitOnlyPolicy('policy:\n  invocation:\n    allow_implicit_invocation: false\n'),
  'rejects the flag nested under a sub-key of policy: — Codex ignores it there',
)
assert.ok(
  !hasExplicitOnlyPolicy('allow_implicit_invocation: false\npolicy:\n  other: true\n'),
  'rejects the flag at top level, outside the policy: block',
)
assert.ok(
  !hasExplicitOnlyPolicy('interface:\n  allow_implicit_invocation: false\n'),
  'rejects a file with no top-level policy: block at all',
)
assert.ok(
  !hasExplicitOnlyPolicy('policy:\n'),
  'rejects an empty policy: block',
)
assert.ok(
  !hasExplicitOnlyPolicy('policy:\n  allow_implicit_invocation: true\n'),
  'rejects the flag set to true',
)

// Spec review decision 1: BOTH full-pipeline entry points are explicit-only in BOTH clients.
// A full secaudit spawns many agents and costs real money; installing the plugin must never
// authorize either client to start one on its own initiative.
const GATED = ['run', 'secaudit-orchestrator']

// `issues` is gated for a different reason: it costs nothing, but it starts a long-lived local
// server that serves the project's findings. Starting and stopping a server is the operator's
// call, so it takes the same explicit gate in both clients.
const SERVERS = ['issues']

for (const name of [...GATED, ...SERVERS]) {
  const skill = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8')
  const frontmatter = skill.split(/^---$/m)[1] ?? ''
  assert.match(
    frontmatter,
    /^disable-model-invocation:\s*true\s*$/m,
    `${name}: Claude half of the gate — disable-model-invocation: true in frontmatter`,
  )

  const yamlPath = join(root, 'skills', name, 'agents', 'openai.yaml')
  assert.ok(existsSync(yamlPath), `${name}: Codex half of the gate — agents/openai.yaml exists`)
  // Codex honours the flag only as a DIRECT CHILD of the top-level `policy:` key — nested
  // deeper, or matched anywhere in the file, it is ignored and the full pipeline stays
  // implicitly invocable.
  assert.ok(
    hasExplicitOnlyPolicy(readFileSync(yamlPath, 'utf8')),
    `${name}: allow_implicit_invocation: false must be a direct child of the top-level policy: block`,
  )
}

// The gate is deliberately narrow. Hunters and single-stage pipeline skills MUST stay
// implicitly invocable — asking for one Hunter is not authorizing the full pipeline — so a
// stray openai.yaml on any other skill is a regression, not extra safety.
const skillDirs = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
for (const name of skillDirs) {
  if (GATED.includes(name) || SERVERS.includes(name)) continue
  assert.ok(
    !existsSync(join(root, 'skills', name, 'agents', 'openai.yaml')),
    `${name}: must NOT be gated — only the two full-pipeline entry points are explicit-only`,
  )
  const skill = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8')
  const frontmatter = skill.split(/^---$/m)[1] ?? ''
  assert.ok(
    !/^disable-model-invocation:\s*true\s*$/m.test(frontmatter),
    `${name}: must NOT set disable-model-invocation — focused analysis stays implicitly available`,
  )
}

console.log('validate-explicit-only: OK')

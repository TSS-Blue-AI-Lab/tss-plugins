import { readFileSync, existsSync, readdirSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasExplicitOnlyPolicy } from './preflight-policy.mjs'

// Plugin manifests live under plugins/secaudit; the marketplace catalogs that reference this
// plugin by path live at the repo root (this repo IS the marketplace, the plugin is not the
// marketplace root — see task-3/4 briefs). Two roots, not one.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(repoRoot, 'plugins', 'secaudit')
const read = rel => readFileSync(join(root, rel), 'utf8')
const readJson = rel => JSON.parse(read(rel))
const readRepo = rel => readFileSync(join(repoRoot, rel), 'utf8')
const readRepoJson = rel => JSON.parse(readRepo(rel))

const PLUGIN_NAME = 'secaudit'
const claudePlugin = readJson('.claude-plugin/plugin.json')
const claudeMarket = readRepoJson('.claude-plugin/marketplace.json')
const codexPlugin = readJson('.codex-plugin/plugin.json')
const codexMarket = readRepoJson('.agents/plugins/marketplace.json')
const codexEntry = codexMarket.plugins[0]

// Identity agrees across every manifest. A mismatch means one client installs a differently
// named plugin, which silently breaks the `secaudit:run` invocation name.
assert.equal(claudePlugin.name, PLUGIN_NAME, 'Claude plugin name')
assert.equal(codexPlugin.name, PLUGIN_NAME, 'Codex plugin name')
assert.equal(claudeMarket.plugins.length, 1, 'Claude marketplace lists exactly one plugin')
assert.equal(claudeMarket.plugins[0].name, PLUGIN_NAME, 'Claude marketplace entry name')
assert.equal(codexMarket.plugins.length, 1, 'Codex marketplace lists exactly one plugin')
assert.equal(codexMarket.plugins[0].name, PLUGIN_NAME, 'Codex marketplace entry name')

// Version agreement is the safety net for manual version bumps (spec decision 8). In this repo
// plugin.json is the sole version authority (global constraint — the root marketplace catalogs
// deliberately carry no version field, since they reference the plugin by local path rather than
// a pinned release), so agreement is checked between the two plugin manifests only.
const versions = [claudePlugin.version, codexPlugin.version]
for (const v of versions) assert.match(v, /^\d+\.\d+\.\d+$/, `semver syntax: ${v}`)
assert.equal(new Set(versions).size, 1, `both plugin manifests declare one version, got ${versions.join(', ')}`)
assert.ok(!('version' in claudeMarket.plugins[0]), 'Claude marketplace entry does not duplicate version (plugin.json is authority)')
assert.ok(!('version' in codexEntry), 'Codex marketplace entry does not duplicate version (plugin.json is authority)')

// Required fields per vendor schema.
assert.ok(claudeMarket.name, 'Claude marketplace has a name')
assert.ok(claudeMarket.owner?.name, 'Claude marketplace has owner.name')
assert.ok(claudePlugin.description, 'Claude plugin has a description')
assert.ok(codexPlugin.description, 'Codex plugin has a description (required)')
assert.ok(codexEntry.category, 'Codex marketplace entry has a category (required)')
assert.ok(
  ['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE'].includes(codexEntry.policy?.installation),
  'Codex policy.installation is a documented value',
)
assert.ok(codexEntry.policy?.authentication, 'Codex policy.authentication is set (required)')

// This plugin lives under plugins/secaudit, not at the marketplace root — the marketplace hosts
// (potentially) more than one plugin, so each catalog entry points at the plugin's subdirectory.
assert.equal(claudeMarket.plugins[0].source, './plugins/secaudit', 'Claude marketplace source points at the plugin subdirectory')
assert.equal(codexEntry.source?.source, 'local', 'Codex marketplace source kind')
assert.equal(codexEntry.source?.path, './plugins/secaudit', 'Codex marketplace source path points at the plugin subdirectory')

// Declared and default-scanned components must actually exist, or the plugin installs empty.
assert.ok(existsSync(join(root, 'skills')), 'skills/ exists (both clients default-scan it)')
assert.ok(existsSync(join(root, 'workflows/secaudit.js')), 'workflows/secaudit.js exists')
assert.equal(codexPlugin.skills, './skills/', 'Codex plugin points at the canonical skills tree')
for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  assert.ok(
    existsSync(join(root, 'skills', entry.name, 'SKILL.md')),
    `skills/${entry.name} has a SKILL.md (a directory without one loads as nothing)`,
  )
  // Installed, the plugin is NOT inside the audited target and the working directory is the
  // target's, so a repo-relative `node skills/...` resolves against the corpus and fails with
  // "Cannot find module". Bundled scripts are invoked through the resolved <PLUGIN_ROOT>.
  // Every SKILL.md, not a hand-listed few: the two that had per-file guards were the two that
  // happened to be reviewed, and a third occurrence slipped in unnoticed.
  assert.ok(
    !/node skills\//.test(read(join('skills', entry.name, 'SKILL.md'))),
    `skills/${entry.name}/SKILL.md invokes a bundled script repo-relative — use "<PLUGIN_ROOT>/skills/..."`,
  )
}

// Claude's default scans find skills/ and workflows/ on their own. Declaring `workflows`
// REPLACES the default scan and declaring `skills` ADDS to it, so a wrong value here is worse
// than no value: assert we are not silently narrowing discovery.
if ('workflows' in claudePlugin) {
  const declared = [].concat(claudePlugin.workflows)
  assert.ok(
    declared.some(p => existsSync(join(root, p))),
    'a declared workflows path must exist (it REPLACES the default workflows/ scan)',
  )
}

// The whole point of the canonical layout: no manifest may resurrect a retired path or leak a
// developer's machine.
const FORBIDDEN = ['.claude/skills', '.agents/skills', 'eval/', '<private-client-identifier>', '.secaudit-local', '/Users/', '..']
for (const [rel, reader] of [
  ['.claude-plugin/plugin.json', read],
  ['.codex-plugin/plugin.json', read],
  ['.claude-plugin/marketplace.json', readRepo],
  ['.agents/plugins/marketplace.json', readRepo],
]) {
  const raw = reader(rel)
  for (const bad of FORBIDDEN) {
    assert.ok(!raw.includes(bad), `${rel} must not reference ${bad}`)
  }
}

// Cross-client explicit-only invariant, asserted from the packaging side too (acceptance
// criterion 3): both full-pipeline entry points, both clients.
for (const name of ['run', 'secaudit-orchestrator']) {
  assert.match(
    read(`skills/${name}/SKILL.md`).split(/^---$/m)[1] ?? '',
    /^disable-model-invocation:\s*true\s*$/m,
    `${name} is explicit-only in Claude Code`,
  )
  // Direct child of the top-level `policy:` key or nothing: Codex ignores the flag anywhere
  // else, so a whole-file substring match would pass a file that does not gate anything.
  assert.ok(
    hasExplicitOnlyPolicy(read(`skills/${name}/agents/openai.yaml`)),
    `${name} is explicit-only in Codex`,
  )
}

console.log('validate-manifests: OK')

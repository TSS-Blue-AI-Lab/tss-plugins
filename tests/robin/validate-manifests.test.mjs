import { readFileSync, existsSync, readdirSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Plugin manifests live under plugins/robin; the marketplace catalogs that reference this plugin
// by path live at the repo root. Two roots, not one.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(repoRoot, 'plugins', 'robin')
const read = rel => readFileSync(join(root, rel), 'utf8')
const readJson = rel => JSON.parse(read(rel))
const readRepoJson = rel => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'))

const PLUGIN_NAME = 'robin'
const claudePlugin = readJson('.claude-plugin/plugin.json')
const codexPlugin = readJson('.codex-plugin/plugin.json')
// Looked up by name, not index: the catalogs list every plugin in this repo, and their order is
// not this plugin's business.
const claudeEntry = readRepoJson('.claude-plugin/marketplace.json').plugins.find(p => p.name === PLUGIN_NAME)
const codexEntry = readRepoJson('.agents/plugins/marketplace.json').plugins.find(p => p.name === PLUGIN_NAME)

// Identity agrees across every manifest. A mismatch means one client installs a differently named
// plugin, which silently breaks the `robin:<skill>` invocation prefix.
assert.equal(claudePlugin.name, PLUGIN_NAME, 'Claude plugin name')
assert.equal(codexPlugin.name, PLUGIN_NAME, 'Codex plugin name')
assert.ok(claudeEntry, 'Claude marketplace lists this plugin')
assert.ok(codexEntry, 'Codex marketplace lists this plugin')

// plugin.json is the sole version authority in this repo — the catalogs reference the plugin by
// local path rather than a pinned release, so a version there could only ever disagree.
const versions = [claudePlugin.version, codexPlugin.version]
for (const v of versions) assert.match(v, /^\d+\.\d+\.\d+$/, `semver syntax: ${v}`)
assert.equal(new Set(versions).size, 1, `both plugin manifests declare one version, got ${versions.join(', ')}`)
assert.ok(!('version' in claudeEntry), 'Claude marketplace entry does not duplicate version (plugin.json is authority)')
assert.ok(!('version' in codexEntry), 'Codex marketplace entry does not duplicate version (plugin.json is authority)')

// Required fields per vendor schema.
assert.ok(claudePlugin.description, 'Claude plugin has a description')
assert.ok(codexPlugin.description, 'Codex plugin has a description (required)')
assert.ok(codexEntry.category, 'Codex marketplace entry has a category (required)')
assert.ok(
  ['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE'].includes(codexEntry.policy?.installation),
  'Codex policy.installation is a documented value',
)
assert.ok(codexEntry.policy?.authentication, 'Codex policy.authentication is set (required)')

// This plugin lives under plugins/robin, not at the marketplace root — the marketplace hosts more
// than one plugin, so each catalog entry points at the plugin's subdirectory.
assert.equal(claudeEntry.source, './plugins/robin', 'Claude marketplace source points at the plugin subdirectory')
assert.equal(codexEntry.source?.source, 'local', 'Codex marketplace source kind')
assert.equal(codexEntry.source?.path, './plugins/robin', 'Codex marketplace source path points at the plugin subdirectory')

// THE load-bearing assertion of this file. Codex auto-discovers a plugin's hooks/hooks.json
// whenever its manifest carries no `hooks` field: load_plugin_hooks falls back to a hardcoded
// DEFAULT_HOOKS_CONFIG_FILE and registers it. That file is this plugin's CLAUDE CODE hook, which
// Codex cannot run — so the fallback buys a dead hook plus an install-time trust prompt for it.
// An absent field, an empty array, and an empty inline hook list ALL collapse back to the
// fallback; only an empty object parses as "an empty inline hook set" and suppresses discovery.
// Hence deepStrictEqual against {} rather than a truthiness or emptiness check.
assert.deepStrictEqual(codexPlugin.hooks, {}, 'Codex manifest declares exactly {} for hooks, suppressing auto-discovery of the Claude Code hook')

// Declared and default-scanned components must actually exist, or the plugin installs empty.
// Claude Code default-scans skills/ and hooks/hooks.json; Codex needs the skills path declared.
assert.equal(codexPlugin.skills, './skills/', 'Codex plugin points at the canonical skills tree')
assert.ok(existsSync(join(root, 'skills')), 'skills/ exists')
const skillDirs = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter(e => e.isDirectory())
assert.ok(skillDirs.length > 0, 'skills/ is not empty')
for (const entry of skillDirs) {
  assert.ok(
    existsSync(join(root, 'skills', entry.name, 'SKILL.md')),
    `skills/${entry.name} has a SKILL.md (a directory without one loads as nothing)`,
  )
}

// The hook is wired by path in two hops: hooks.json calls the wrapper through CLAUDE_PLUGIN_ROOT,
// and the wrapper execs its sibling by name. A rename on either side fails silently at runtime.
assert.ok(
  read('hooks/hooks.json').includes('${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd'),
  'hooks.json calls the wrapper through CLAUDE_PLUGIN_ROOT',
)
for (const f of ['hooks/run-hook.cmd', 'hooks/notes-rule']) {
  assert.ok(existsSync(join(root, f)), `${f} ships with the plugin`)
}

// Tests never ship: the bash checks live at tests/robin/, not inside the installed tree. Copying
// the whole hooks/ directory across is the easy way to get this wrong.
assert.ok(
  !existsSync(join(root, 'hooks', 'test-notes-rule')),
  'the hook test does not ship inside the plugin',
)

console.log('robin validate-manifests: OK')

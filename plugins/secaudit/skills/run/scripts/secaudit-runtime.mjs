#!/usr/bin/env node
// skills/run/scripts/secaudit-runtime.mjs
// secaudit deterministic runtime: read-only `inspect` and (Task 4) workspace `prepare`.
// One JSON result line on stdout, diagnostics on stderr, stable error codes, no prompts.
import { mkdir, writeFile, copyFile, readlink, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, dirname, sep, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { enumerateSource, measureSource, EXCLUDED_DIR_NAMES, hashSource } from './source-corpus.mjs'
import { RuntimeError, resolveTarget, targetSource, makeRunId, selectRunDir, writeMarker, canonicalizePlanned, resolveArtifactRoot, findGitToplevel } from './run-paths.mjs'

const USAGE = `Usage:
  node secaudit-runtime.mjs inspect --target <path> [--scope <relative-path>]...
  node secaudit-runtime.mjs prepare --target <path> [--output <exact-run-directory>] [--scope <relative-path>]...

inspect is read-only: it reports source measurements, recognized manifests, and
the exclusions that would apply, and never writes to the target.
prepare validates, hashes, creates the run directory + ownership marker, and
copies the source into an isolated work tree. Without --output the run directory
defaults to <project-root>/.secaudit/runs/<run-id>, where project root is the
target's own Git toplevel, else the Git toplevel above the current directory
(so auditing a staged copy still reports into the real repository), else the
target itself.
--scope restricts WHAT IS READ to the given target-relative paths (repeatable,
or one comma-separated value). The target, project root, and corpus hash still
refer to the real repository, so a partial audit never needs a staged copy.

Results: one JSON line on stdout. Diagnostics: stderr.
Failure: exit 1 with {"error":{"code","message"}} on stdout. Codes:
E_USAGE, E_TARGET_MISSING, E_TARGET_NOT_DIRECTORY, E_OUTPUT_IS_TARGET,
E_OUTPUT_CONTAINS_TARGET, E_OUTPUT_NOT_EMPTY_UNOWNED, E_OUTPUT_RUN_EXISTS,
E_UNDECLARED_RUN_DIR, E_WORKTREE_SYMLINK_ESCAPE, E_SCOPE_UNKNOWN,
E_SCOPE_EMPTY, E_RUN_STATE, E_RUN_MARKER_MISSING, E_UNEXPECTED.`

// An undeclared secaudit-run.json inside the target silently drops its whole subtree from
// enumeration, hashing, and every hunter — a false all-clear. Only the operator can resolve it.
// Note the remediation carefully: pointing --output at an EXISTING run directory does not declare
// it, it fails (E_OUTPUT_RUN_EXISTS / E_OUTPUT_NOT_EMPTY_UNOWNED). The two things that actually
// work are deleting it, or moving it under `<target>/.secaudit/`, which is excluded by directory
// name and so never reaches this check. Until then EVERY prepare on this target refuses, including
// a default `.secaudit/runs/` one — the hidden subtree is a property of the corpus, not of where
// this particular run wants to write.
function undeclaredRunDirMessage(excludedRunDirs) {
  return 'undeclared secaudit run marker directories inside the target would be hidden from the '
    + 'audit: ' + excludedRunDirs.join(', ')
    + ' — delete each one, or move it under ' + join('<target>', '.secaudit') + '/ (excluded by '
    + 'name), then re-run. Every prepare on this target refuses until then, including a default '
    + 'one: the pruned subtree would be absent from the corpus hash on both sides of the '
    + 'publication gate, so the run would certify a corpus it never read'
}

// Scope mistakes must never degrade quietly into a wider or narrower audit than the operator
// asked for: a typo that silently audits nothing is a false all-clear.
function assertScopeUsable({ scope, scopeMisses }, coverage) {
  if (scopeMisses.length > 0) {
    throw new RuntimeError('E_SCOPE_UNKNOWN',
      'scope entries matched nothing under the target: ' + scopeMisses.join(', ')
      + ' — check the paths (they are relative to the target, forward-slashed) and re-run')
  }
  if (scope.length > 0 && coverage.sourceFiles === 0) {
    throw new RuntimeError('E_SCOPE_EMPTY',
      'the selected scope contains no recognized source files: ' + scope.join(', '))
  }
}

const MANIFEST_NAMES = new Set([
  'package.json', 'pom.xml', 'requirements.txt', 'pyproject.toml', 'go.mod',
])
const MANIFEST_EXTENSIONS = new Set(['.csproj', '.sln', '.graphql'])

function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = { '--target': 'target', '--output': 'output' }
  const options = { command, scope: [] }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--help') {
      options.help = true
      continue
    }
    if (rest[i] === '--scope') {
      const value = rest[++i]
      if (value == null) throw new RuntimeError('E_USAGE', 'missing value for --scope')
      // Repeatable, and one flag may carry a comma-separated list — operators type both.
      options.scope.push(...value.split(',').map(sc => sc.trim()).filter(Boolean))
      continue
    }
    const key = flags[rest[i]]
    if (!key) throw new RuntimeError('E_USAGE', 'unknown argument: ' + rest[i])
    const value = rest[++i]
    if (value == null) throw new RuntimeError('E_USAGE', 'missing value for ' + rest[i - 1])
    options[key] = value
  }
  return options
}

function isManifest(rel) {
  const base = rel.split('/').pop()
  return MANIFEST_NAMES.has(base) || MANIFEST_EXTENSIONS.has(extname(base).toLowerCase())
}

export async function inspect(options) {
  const target = await resolveTarget(options.target, process.cwd())
  const { artifactRoot, artifactRootSource } = await resolveArtifactRoot(target, process.cwd())
  const { files, internalSymlinks, externalSymlinks, excludedDirsHit, excludedRunDirs, scope,
    scopeMisses } = await enumerateSource(target, { scope: options.scope ?? [] })
  const coverage = await measureSource(target, files)
  const extensions = {}
  for (const rel of files) {
    const ext = extname(rel).toLowerCase()
    if (ext) extensions[ext] = (extensions[ext] ?? 0) + 1
  }
  // inspect is read-only reconnaissance so it stays exit 0, but the anomaly must be impossible
  // to miss: the SKILL surfaces `warnings` verbatim, so it goes there and not only in an array.
  const warnings = []
  if (coverage.sourceFiles === 0) warnings.push('no recognized source files under target')
  // The report follows the project, not the corpus — say so BEFORE the spend, because this is
  // the one thing about a run the operator cannot discover afterwards by looking in the repo.
  if (artifactRoot !== target) {
    warnings.push('reports will be written to ' + join(artifactRoot, '.secaudit', 'runs')
      + ', outside the audited tree ('
      + (artifactRootSource === 'cwdGitRoot'
        ? 'the target is not in a Git working tree, so the run follows the repository you are '
          + 'standing in — this is what keeps a staged-copy audit out of the copy'
        : 'the target sits inside that repository')
      + '); pass --output to place them somewhere else')
  }
  if (scopeMisses.length > 0) {
    warnings.push('scope entries matched nothing under the target: ' + scopeMisses.join(', ')
      + ' — prepare will refuse until they are corrected')
  }
  if (excludedRunDirs.length > 0) {
    warnings.push('CORPUS INTEGRITY: ' + undeclaredRunDirMessage(excludedRunDirs)
      + ' (each holds a secaudit-run.json marker); prepare will refuse until then')
  }
  return {
    target,
    targetSource: targetSource(options.target, process.cwd()),
    artifactRoot,
    artifactRootSource,
    coverage,
    scope,
    scopeMisses,
    extensions,
    manifests: files.filter(isManifest),
    exclusionsApplied: excludedDirsHit,
    excludedRunDirs,
    exclusionPolicy: [...EXCLUDED_DIR_NAMES].sort(),
    skippedExternalSymlinks: externalSymlinks,
    internalSymlinks,
    warnings,
  }
}

// The work tree must be isolated. An internal symlink copied verbatim with an ABSOLUTE target
// still resolves into the audited repo, so writing through the work tree mutates the corpus.
// Rewrite corpus-absolute targets into the work tree; refuse anything that still escapes it.
function rewriteLinkTarget(rawTarget, rel, target, work, dstDir) {
  const rewritten = isAbsolute(rawTarget) && (rawTarget === target || rawTarget.startsWith(target + sep))
    ? join(work, relative(target, rawTarget))
    : rawTarget
  const landing = resolve(dstDir, rewritten)
  if (landing !== work && !landing.startsWith(work + sep)) {
    throw new RuntimeError('E_WORKTREE_SYMLINK_ESCAPE',
      'internal symlink ' + rel + ' targets ' + rawTarget + ', which cannot be kept inside the '
      + 'isolated work tree; refusing the run rather than linking out of it')
  }
  return rewritten
}

// Resolved before anything is created, so an escaping link refuses the run without a work tree.
async function planInternalSymlinks(target, internalSymlinks, work) {
  const plan = []
  for (const rel of internalSymlinks) {
    const parts = rel.split('/')
    const dst = join(work, ...parts)
    const rawTarget = await readlink(join(target, ...parts))
    plan.push({ rel, dst, linkTarget: rewriteLinkTarget(rawTarget, rel, target, work, dirname(dst)) })
  }
  return plan
}

async function copyWorkTree(target, files, symlinkPlan, work) {
  for (const rel of files) {
    const src = join(target, ...rel.split('/'))
    const dst = join(work, ...rel.split('/'))
    await mkdir(dirname(dst), { recursive: true })
    await copyFile(src, dst)
  }
  const degradedSymlinks = []
  for (const { rel, dst, linkTarget } of symlinkPlan) {
    await mkdir(dirname(dst), { recursive: true })
    try {
      await symlink(linkTarget, dst)
    } catch {
      // Hosts that forbid symlink creation get resolved content instead, and we say so.
      const src = join(target, ...rel.split('/'))
      const copiedContent = await copyFile(src, dst).then(() => true, () => false)
      degradedSymlinks.push({ path: rel, copiedContent })
    }
  }
  return degradedSymlinks
}

export async function prepare(options) {
  const target = await resolveTarget(options.target, process.cwd())
  const { artifactRoot, artifactRootSource } = await resolveArtifactRoot(target, process.cwd())
  const extraExcluded = []
  if (options.output) {
    const planned = await canonicalizePlanned(options.output)
    if (planned.startsWith(target + sep)) extraExcluded.push(planned)
  }
  const { files, internalSymlinks, externalSymlinks, excludedRunDirs, scope, scopeMisses } =
    await enumerateSource(target, { extraExcluded, scope: options.scope ?? [] })
  // Fail closed BEFORE writing anything: those subtrees are absent from the corpus we are about
  // to hash and copy, and both sides of the publication gate would agree on the pruned corpus.
  if (excludedRunDirs.length > 0) {
    throw new RuntimeError('E_UNDECLARED_RUN_DIR', undeclaredRunDirMessage(excludedRunDirs))
  }
  const coverage = await measureSource(target, files)
  assertScopeUsable({ scope, scopeMisses }, coverage)
  const corpusSha256 = await hashSource(target, files,
    [...internalSymlinks, ...externalSymlinks])
  const nowIso = new Date().toISOString()
  const generatedDate = nowIso.slice(0, 10)
  const runsDefault = join(artifactRoot, '.secaudit', 'runs')
  const runId = makeRunId(nowIso, corpusSha256.slice(0, 8),
    id => existsSync(join(runsDefault, id)))
  const { runDir, insideTarget, isDefault: isDefaultRunDir } =
    await selectRunDir(target, options.output, runId, artifactRoot)
  const work = join(runDir, 'work')
  const symlinkPlan = await planInternalSymlinks(target, internalSymlinks, work)
  await mkdir(runDir, { recursive: true })
  if (insideTarget || findGitToplevel(runDir)) {
    // The work tree copies the target's dotfiles verbatim, secrets included, so a run directory
    // git can see is one `git add -A` from committing them. Any run directory inside a working
    // tree ignores its own contents — including the default one, which now follows the project
    // root and so routinely lands in a repository that is not the target.
    await writeFile(join(runDir, '.gitignore'), '*\n', 'utf8')
  }
  await writeMarker(runDir, { runId, target, createdUtc: nowIso, state: 'preparing' })
  const degradedSymlinks = await copyWorkTree(target, files, symlinkPlan, work)
  await writeMarker(runDir, {
    runId,
    target,
    createdUtc: nowIso,
    state: 'prepared',
    insideTarget,
    projectRoot: artifactRoot,
    artifactRoot,
    artifactRootSource,
    scope,
    work,
    coverage,
    corpusSha256,
    skippedExternalSymlinks: externalSymlinks,
  })
  // A default run lives under <projectRoot>/.secaudit/runs and is rediscoverable by walking the
  // filesystem. An explicitly placed one is not — if it is not indexed now, the dashboard will
  // never learn it existed.
  if (!isDefaultRunDir) {
    const { registerRun } = await import('../../issues/scripts/run-catalog.mjs')
    await registerRun(artifactRoot, { runId, runDir })
  }
  return {
    runId,
    runDir,
    work,
    target,
    projectRoot: artifactRoot,
    scope,
    coverage,
    corpusSha256,
    generatedDate,
    insideTarget,
    artifactRoot,
    artifactRootSource,
    skippedExternalSymlinks: externalSymlinks,
    excludedRunDirs,
    internalSymlinks,
    degradedSymlinks,
  }
}

const COMMANDS = { inspect, prepare }

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.command) {
    console.log(USAGE)
    return
  }
  const command = COMMANDS[options.command]
  if (!command) throw new RuntimeError('E_USAGE', 'unknown command: ' + options.command)
  console.log(JSON.stringify(await command(options)))
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch(err => {
    const code = err instanceof RuntimeError ? err.code : 'E_UNEXPECTED'
    console.log(JSON.stringify({ error: { code, message: err.message } }))
    console.error('secaudit-runtime: ' + err.message)
    process.exitCode = 1
  })
}

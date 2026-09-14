// One shared exclusion policy drives enumeration, measurement, and hashing, so
// dependency/build churn can never move the corpus hash (spec review decision 4).
import { readdir, readFile, realpath, readlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, extname, sep } from 'node:path'

export const EXCLUDED_DIR_NAMES = new Set([
  '.git', '.secaudit', 'node_modules', 'bin', 'obj', 'dist', 'build',
  'vendor', '.venv', 'venv', 'target', '__pycache__',
])

export const SOURCE_EXTENSIONS = new Set([
  '.cs', '.ts', '.js', '.java', '.kt', '.py', '.go', '.html', '.cshtml',
])

// Mirrors run-paths.mjs' readMarker envelope check (marker + formatVersion),
// inlined so this stays a leaf module with no dependency on run-paths.mjs.
const RUN_MARKER_NAME = 'secaudit-run.json'
// Mirrors run-paths.mjs' SUPPORTED_MARKER_VERSIONS, inlined so this stays a leaf module.
const RUN_MARKER_FORMAT_VERSIONS = new Set([1, 2])

async function isRunMarkerDir(dirAbs, entries) {
  if (!entries.some(e => e.isFile() && e.name === RUN_MARKER_NAME)) return false
  const raw = await readFile(join(dirAbs, RUN_MARKER_NAME), 'utf8').catch(() => null)
  if (raw == null) return false
  try {
    const parsed = JSON.parse(raw)
    return parsed.marker === 'secaudit-run' && RUN_MARKER_FORMAT_VERSIONS.has(parsed.formatVersion)
  } catch {
    return false
  }
}

function toPosix(relPath) {
  return relPath.split(sep).join('/')
}

function countLines(buffer) {
  if (buffer.length === 0) return 0
  let newlines = 0
  for (let i = 0; i < buffer.length; i++) if (buffer[i] === 0x0a) newlines += 1
  return buffer[buffer.length - 1] === 0x0a ? newlines : newlines + 1
}

// Scope entries are POSIX-relative paths under the target. They restrict WHAT IS READ; they
// never move the root, so the project identity, artifact root, and corpus hash keep pointing
// at the real repository — which is exactly what hand-staging a copy used to destroy.
function normalizeScope(root, scope) {
  const normalized = []
  for (const raw of scope) {
    const rel = raw.split(sep).join('/').replace(/^\.\/+/, '').replace(/\/+$/, '')
    if (rel === '' || rel === '.') return [] // an explicit whole-tree scope
    const abs = join(root, ...rel.split('/'))
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error('scope entry escapes the target: ' + raw)
    }
    normalized.push(rel)
  }
  return [...new Set(normalized)].sort()
}

function inScope(rel, scope) {
  if (scope.length === 0) return true
  return scope.some(s => rel === s || rel.startsWith(s + '/'))
}

// True when a directory could still contain in-scope files, so recursion is not pruned early.
function scopeTouchesDir(rel, scope) {
  if (scope.length === 0) return true
  return scope.some(s => rel === '' || s === rel || s.startsWith(rel + '/') || rel.startsWith(s + '/'))
}

function matchedScopeEntry(rel, scope) {
  return scope.find(s => rel === s || rel.startsWith(s + '/'))
}

// root must already be canonical (realpath'd by the caller).
export async function enumerateSource(root, { extraExcluded = [], scope = [] } = {}) {
  const normalizedScope = normalizeScope(root, scope)
  const seenScope = new Set()
  const prefixes = extraExcluded.map(p => (p.endsWith(sep) ? p : p + sep))
  const files = []
  const internalSymlinks = []
  const externalSymlinks = []
  const excludedDirsHit = new Set()
  // `excludedRunDirs` is an ANOMALY list, not routine housekeeping: `extraExcluded` prefixes are
  // pruned below before recursion, so a declared run directory never reaches isRunMarkerDir.
  // Every entry here is therefore an UNDECLARED marker directory whose subtree has been dropped
  // from enumeration, measurement, hashing, and the work tree. Callers must fail loud on it.
  const excludedRunDirs = []
  async function recurse(dirAbs, isRoot) {
    const entries = await readdir(dirAbs, { withFileTypes: true })
    if (!isRoot && await isRunMarkerDir(dirAbs, entries)) {
      excludedRunDirs.push(toPosix(relative(root, dirAbs)))
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const abs = join(dirAbs, entry.name)
      const rel = toPosix(relative(root, abs))
      if (entry.isSymbolicLink()) {
        if (!inScope(rel, normalizedScope)) continue
        const dest = await realpath(abs).catch(() => null)
        if (dest && (dest === root || dest.startsWith(root + sep))) internalSymlinks.push(rel)
        else externalSymlinks.push(rel)
        continue
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) {
          excludedDirsHit.add(entry.name)
          continue
        }
        if (prefixes.some(p => (abs + sep).startsWith(p))) continue
        if (!scopeTouchesDir(rel, normalizedScope)) continue
        if (inScope(rel, normalizedScope)) seenScope.add(matchedScopeEntry(rel, normalizedScope))
        await recurse(abs, false)
      } else if (entry.isFile()) {
        if (!inScope(rel, normalizedScope)) continue
        seenScope.add(matchedScopeEntry(rel, normalizedScope))
        files.push(rel)
      }
    }
  }
  await recurse(root, true)
  return {
    files: [...files].sort(),
    internalSymlinks: [...internalSymlinks].sort(),
    externalSymlinks: [...externalSymlinks].sort(),
    excludedDirsHit: [...excludedDirsHit].sort(),
    excludedRunDirs: [...excludedRunDirs].sort(),
    scope: normalizedScope,
    scopeMisses: normalizedScope.filter(s => !seenScope.has(s)),
  }
}

export async function measureSource(root, files) {
  let sourceFiles = 0
  let sourceLines = 0
  let sourceBytes = 0
  for (const rel of files) {
    if (!SOURCE_EXTENSIONS.has(extname(rel).toLowerCase())) continue
    const buffer = await readFile(join(root, ...rel.split('/')))
    sourceFiles += 1
    sourceBytes += buffer.length
    sourceLines += countLines(buffer)
  }
  return {
    sourceFiles,
    sourceLines,
    sourceBytes,
    estimatedSourceTokens: Math.ceil(sourceBytes / 4),
  }
}

function hashEntry(hash, kind, rel, payload) {
  const relBytes = Buffer.from(rel, 'utf8')
  hash.update(kind) // 'f'/'l' keeps a file and a same-named symlink from colliding
  hash.update(relBytes.length + ':')
  hash.update(relBytes)
  hash.update(payload.length + ':')
  hash.update(payload)
}

// `symlinks` are POSIX-relative paths (internal AND external). Their link targets are part of
// the digest: without them, adding, removing, or retargeting a symlink in the audited corpus is
// invisible to the publication gate, which would then certify a changed corpus as pristine.
export async function hashSource(root, files, symlinks = []) {
  const hash = createHash('sha256')
  for (const rel of [...files].sort()) {
    hashEntry(hash, 'f', rel, await readFile(join(root, ...rel.split('/'))))
  }
  for (const rel of [...symlinks].sort()) {
    const dest = await readlink(join(root, ...rel.split('/')))
    hashEntry(hash, 'l', rel, Buffer.from(dest, 'utf8'))
  }
  return hash.digest('hex')
}

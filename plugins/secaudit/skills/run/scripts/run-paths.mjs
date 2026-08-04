// Target resolution, run identity, run-directory validation, ownership marker.
// Every rejection carries a stable machine-readable code (see USAGE in the CLI).
import { realpath, stat, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, basename, sep } from 'node:path'

export const MARKER_NAME = 'secaudit-run.json'
export const MARKER_FORMAT_VERSION = 1

export class RuntimeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function findGitToplevel(startDir) {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// Omitted input → git toplevel above cwd, else cwd (spec review decision 5).
export async function resolveTarget(input, cwd) {
  const candidate = input ? resolve(cwd, input) : (findGitToplevel(cwd) ?? resolve(cwd))
  const st = await stat(candidate).catch(() => null)
  if (!st) throw new RuntimeError('E_TARGET_MISSING', 'target does not exist: ' + candidate)
  if (!st.isDirectory()) {
    throw new RuntimeError('E_TARGET_NOT_DIRECTORY', 'target is not a directory: ' + candidate)
  }
  return realpath(candidate)
}

export function makeRunId(nowIso, hash8, isTaken) {
  const ts = nowIso.slice(0, 19).replace(/[-:]/g, '') + 'Z'
  let id = ts + '-' + hash8
  for (let n = 2; isTaken(id); n += 1) id = ts + '-' + hash8 + '-' + n
  return id
}

// Canonicalize a possibly not-yet-existing path: realpath the deepest existing
// ancestor, then re-append the non-existing remainder. Defeats symlink aliasing.
export async function canonicalizePlanned(p) {
  let existing = resolve(p)
  const remainder = []
  while (!existsSync(existing)) {
    remainder.unshift(basename(existing))
    const parent = dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const canonicalBase = await realpath(existing)
  return remainder.length ? join(canonicalBase, ...remainder) : canonicalBase
}

export async function readMarker(dir) {
  const raw = await readFile(join(dir, MARKER_NAME), 'utf8').catch(() => null)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed.marker === 'secaudit-run' && parsed.formatVersion === MARKER_FORMAT_VERSION) {
      return parsed
    }
  } catch { /* not a marker */ }
  return null
}

export async function writeMarker(dir, fields) {
  const marker = { marker: 'secaudit-run', formatVersion: MARKER_FORMAT_VERSION, ...fields }
  await writeFile(join(dir, MARKER_NAME), JSON.stringify(marker, null, 2) + '\n', 'utf8')
  return marker
}

// Validate the requested run directory (or pick the default) against the canonical target.
export async function selectRunDir(target, requested, runId) {
  if (!requested) {
    return {
      runDir: join(target, '.secaudit', 'runs', runId),
      insideTarget: true,
      isDefault: true,
    }
  }
  const runDir = await canonicalizePlanned(requested)
  if (runDir === target) {
    throw new RuntimeError('E_OUTPUT_IS_TARGET', 'output must not be the target itself: ' + runDir)
  }
  if (target.startsWith(runDir + sep)) {
    throw new RuntimeError('E_OUTPUT_CONTAINS_TARGET', 'output must not contain the target: ' + runDir)
  }
  if (existsSync(runDir)) {
    const entries = await readdir(runDir)
    if (entries.length > 0) {
      const marker = await readMarker(runDir)
      if (!marker) {
        throw new RuntimeError('E_OUTPUT_NOT_EMPTY_UNOWNED',
          'output exists, is not empty, and is not a secaudit run directory: ' + runDir)
      }
      throw new RuntimeError('E_OUTPUT_RUN_EXISTS',
        'output already holds secaudit run ' + marker.runId + ': ' + runDir)
    }
  }
  return { runDir, insideTarget: runDir.startsWith(target + sep), isDefault: false }
}

// plugins/secaudit/skills/issues/scripts/run-catalog.mjs
// Where this project's runs live. Default runs are rediscoverable from the filesystem; an
// explicitly placed --output run is not, so prepare registers it here. The catalog is a
// convenience index, never the source of truth: a corrupt one must not hide the default runs.
import { readdir, readFile, writeFile, rename, mkdir, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { readMarker } from '../../run/scripts/run-paths.mjs'

export const CATALOG_NAME = 'catalog.json'
export const CATALOG_VERSION = 1

export function catalogPath(projectRoot) {
  return join(projectRoot, '.secaudit', CATALOG_NAME)
}

const EMPTY = () => ({ catalogVersion: CATALOG_VERSION, runs: [] })

export async function readCatalog(projectRoot) {
  const raw = await readFile(catalogPath(projectRoot), 'utf8').catch(() => null)
  if (raw == null) return EMPTY()
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.catalogVersion !== CATALOG_VERSION || !Array.isArray(parsed.runs)) return EMPTY()
    return parsed
  } catch {
    return EMPTY()
  }
}

// `.secaudit/` holds the catalog and the run directories, and it routinely sits inside a working
// tree. An audit must never make a clean repository look dirty, so the index directory ignores
// its own contents — the same guarantee each run directory already gives for its work tree.
async function ensureIgnoredDir(dir) {
  await mkdir(dir, { recursive: true })
  const marker = join(dir, '.gitignore')
  if (!(await readFile(marker, 'utf8').catch(() => null))) {
    await writeFile(marker, '*\n', 'utf8')
  }
}

async function atomicWriteJson(path, value) {
  await ensureIgnoredDir(dirname(path))
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}

export async function registerRun(projectRoot, { runId, runDir }) {
  const catalog = await readCatalog(projectRoot)
  if (catalog.runs.some(r => r.runId === runId)) return catalog
  const next = {
    catalogVersion: CATALOG_VERSION,
    runs: [...catalog.runs, { runId, runDir }].sort((a, b) => (a.runId < b.runId ? -1 : 1)),
  }
  await atomicWriteJson(catalogPath(projectRoot), next)
  return next
}

async function canonical(path) {
  return realpath(path).catch(() => null)
}

export async function discoverRuns(projectRoot) {
  const found = new Map() // canonical runDir -> entry
  const defaultRoot = join(projectRoot, '.secaudit', 'runs')
  for (const entry of await readdir(defaultRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const dir = join(defaultRoot, entry.name)
    const marker = await readMarker(dir)
    if (!marker) continue
    const key = (await canonical(dir)) ?? dir
    found.set(key, { runId: marker.runId ?? entry.name, runDir: dir, source: 'default' })
  }
  for (const { runId, runDir } of (await readCatalog(projectRoot)).runs) {
    const key = (await canonical(runDir)) ?? runDir
    if (found.has(key)) continue
    if (!(await readMarker(runDir))) continue
    found.set(key, { runId, runDir, source: 'catalog' })
  }
  return [...found.values()].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
}

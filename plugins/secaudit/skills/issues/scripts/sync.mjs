// plugins/secaudit/skills/issues/scripts/sync.mjs
// Bring the issue store up to date with every discoverable run. Ingestion is ordered oldest
// first so a first-time import replays history as it happened. A repeat is reported as a
// repeat: presenting a finding the operator triaged three runs ago as "new" is how a board
// loses its credibility.
import { pathToFileURL } from 'node:url'
import { discoverRuns } from './run-catalog.mjs'
import { importRun } from './run-import.mjs'
import { readStore, writeStore, ingestRun } from './issue-store.mjs'

const EMPTY_SUMMARY = () => ({ new: 0, repeat: 0, reopened: 0, suppressed: 0, ambiguous: 0 })

export async function syncProject(projectRoot) {
  const imported = []
  const unavailable = []
  for (const { runDir } of await discoverRuns(projectRoot)) {
    const result = await importRun(runDir)
    if (result.status === 'ok') imported.push(result)
    else unavailable.push({ runId: result.runId, runDir: result.runDir, reason: result.reason })
  }
  imported.sort((a, b) => {
    const ka = a.createdUtc ?? a.runId
    const kb = b.createdUtc ?? b.runId
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  let store = await readStore(projectRoot)
  const summary = EMPTY_SUMMARY()
  let changed = false
  for (const run of imported) {
    const result = ingestRun(store, run)
    if (result.store !== store) changed = true
    store = result.store
    for (const { outcome } of result.outcomes) summary[outcome] += 1
  }
  if (changed) store = await writeStore(projectRoot, store)
  return { store, summary, unavailable }
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') options.project = argv[++i]
    else throw new Error('sync: unknown argument ' + argv[i])
  }
  if (!options.project) throw new Error('sync: --project <path> is required')
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { project } = parseArgs(process.argv.slice(2))
  syncProject(project)
    .then(({ store, summary, unavailable }) => {
      console.log(JSON.stringify({ summary, unavailable, issueCount: store.issues.length }))
    })
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}

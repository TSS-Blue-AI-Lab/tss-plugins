#!/usr/bin/env node
// secaudit-generate-artifacts verifier: a fail-loud post-condition on the published
// deliverables. publish-artifacts.mjs runs inside an LLM agent, which can return a
// plausible {confirmed,refuted,manualReview} even when the publish threw and wrote
// nothing. This deterministic checker re-reads the run directory from disk, reports each
// artifact's byte size, and exits non-zero listing any that are missing or empty — an
// independent gate with no stake in publish having succeeded.
import { stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// The deliverables a completed run must leave behind: provenance in the run directory, and the
// structured findings the dashboard reads. Checked by a process with no stake in publish having
// succeeded.
export const ARTIFACT_FILES = {
  traceMd: 'trace.md',
  reportData: join('work', 'sast', 'report-data.json'),
}

// A published artifact is valid only if it exists with >0 bytes. -1 (missing), 0 (empty),
// or any non-positive / non-integer size counts as missing — the whole point is to catch a
// publish step that reported success but produced no deliverable. Returns the filenames.
export function missingArtifacts(sizes) {
  return Object.entries(ARTIFACT_FILES)
    .filter(([key]) => !(Number.isInteger(sizes?.[key]) && sizes[key] > 0))
    .map(([, filename]) => filename)
}

export async function verifyArtifacts(options) {
  const { runDir } = options ?? {}
  if (typeof runDir !== 'string' || runDir.length === 0) {
    throw new Error('verify-artifacts: runDir is required')
  }
  const sizes = {}
  for (const [key, filename] of Object.entries(ARTIFACT_FILES)) {
    const st = await stat(join(runDir, ...filename.split(sep))).catch(() => null)
    sizes[key] = st && st.isFile() ? st.size : -1
  }
  return { sizes, missing: missingArtifacts(sizes) }
}

function parseArgs(argv) {
  const flags = { '--run-dir': 'runDir' }
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const key = flags[argv[i]]
    if (!key) throw new Error('verify-artifacts: unknown argument ' + argv[i])
    options[key] = argv[++i]
  }
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  verifyArtifacts(parseArgs(process.argv.slice(2)))
    .then(result => {
      process.stdout.write(JSON.stringify(result) + '\n')
      if (result.missing.length) process.exitCode = 1
    })
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}

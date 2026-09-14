// plugins/secaudit/skills/issues/scripts/issue-store.mjs
// Persistent issue identity and human decisions. Two rules dominate the design:
//   1. The audit never moves a card. Only a human transition changes humanState.
//   2. Absence proves nothing. Scope and coverage differ between runs, so a finding that stops
//      appearing is not fixed — nothing here closes an issue on its own.
import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { ensureIgnoredDir } from './run-catalog.mjs'
import { classifyFinding } from '../../secaudit-generate-artifacts/scripts/report-contract.mjs'

export const STORE_VERSION = 2

export function storePath(projectRoot) {
  return join(projectRoot, '.secaudit', 'issues.json')
}

export function emptyStore() {
  return { storeVersion: STORE_VERSION, revision: 0, issues: [], importedRuns: [] }
}

// From the mockup (output/secaudit-workbench.html:318,323). Note the asymmetry, and that it is
// deliberate: a HUMAN who reopens a done issue is re-triaging it, so it goes back to the inbox.
// The AUDIT reopening a done issue (attach(), below) lands it in confirmed instead, because a
// human already confirmed that finding once and that decision is not discarded.
const TRANSITIONS = {
  inbox: { confirm: 'confirmed', 'false-positive': 'suppressed' },
  confirmed: { reopen: 'inbox', done: 'done', 'false-positive': 'suppressed' },
  done: { reopen: 'inbox', confirm: 'confirmed', 'false-positive': 'suppressed' },
  suppressed: { restore: 'inbox' },
}

function issueIdFor(observation) {
  return 'iss_' + createHash('sha256')
    .update([observation.class, observation.path, observation.fingerprint].join(' '), 'utf8')
    .digest('hex').slice(0, 16)
}

const seenKey = (runId, observationId) => runId + ' ' + observationId

// A legacy fingerprint carries a line number and no anchor, so it cannot be compared with an
// anchored one. Rather than guess, an observation that merely RESEMBLES an existing issue is
// attached and flagged for an explicit human merge decision.
const fingerprintKind = fp => (fp.startsWith('legacy1:') ? 'legacy' : 'anchor')

function findMatch(issues, observation) {
  const exact = issues.find(i => i.fingerprints.includes(observation.fingerprint))
  if (exact) return { issue: exact, ambiguous: false }
  // Two ANCHORED fingerprints that differ are two different defects — that is exactly what the
  // anchor is for, and resemblance must not collapse them back together. Resemblance only
  // bridges the namespace gap: an issue known by anchors meeting a legacy observation, or the
  // reverse, where no comparison is possible and only a human can decide.
  const kind = fingerprintKind(observation.fingerprint)
  const resembling = issues.filter(i => i.class === observation.class
    && i.path === observation.path
    && !i.fingerprints.some(fp => fingerprintKind(fp) === kind))
  if (resembling.length === 1) return { issue: resembling[0], ambiguous: true }
  return { issue: null, ambiguous: resembling.length > 1 }
}

const withEvent = (issue, event) => ({ ...issue, events: [...issue.events, event] })

// Two different things can archive an issue and they are NOT interchangeable. A human
// dismissal is absolute: it survives every later run and suppresses the finding at publication.
// An audit refutation is provisional: it is the audit's latest word, and the moment a later run
// stops refuting the same defect it returns to the inbox. Collapsing the two would either
// re-raise dismissed findings or silently bury a defect nobody reviewed.
const suppressedByOf = issue => issue.suppressedBy ?? 'human'

function attach(issue, observation, runCreatedUtc) {
  const next = {
    ...issue,
    title: observation.title,
    line: observation.line,
    severity: observation.severity ?? issue.severity,
    fingerprints: issue.fingerprints.includes(observation.fingerprint)
      ? issue.fingerprints
      : [...issue.fingerprints, observation.fingerprint],
    observations: [...issue.observations, {
      runId: observation.runId,
      observationId: observation.observationId,
      fingerprint: observation.fingerprint,
    }],
    // The full record, kept so the detail view can show the audit's own words after the run
    // directory is gone. Keyed by observationId, never overwritten in place.
    evidence: { ...issue.evidence, [observation.observationId]: observation },
    lastSeenRunId: observation.runId,
  }
  if (issue.humanState === 'suppressed') {
    if (suppressedByOf(issue) === 'audit' && observation.bucket !== 'refuted') {
      return {
        issue: withEvent({ ...next, humanState: 'inbox', suppressedBy: null }, {
          utc: runCreatedUtc, actor: 'system', type: 'no-longer-refuted',
          from: 'suppressed', to: 'inbox', runId: observation.runId,
        }),
        outcome: 'unrefuted',
      }
    }
    return {
      issue: withEvent(next, { utc: runCreatedUtc, actor: 'system', type: 'suppressed-match', runId: observation.runId }),
      outcome: 'suppressed',
    }
  }
  // Only a run that STARTED after the human's decision can reopen it: importing an old run late
  // is new information about the past, not evidence the defect came back.
  const isNewer = !next.lastHumanUtc || (runCreatedUtc != null && runCreatedUtc > next.lastHumanUtc)
  if (issue.humanState === 'done' && isNewer) {
    return {
      issue: withEvent({ ...next, humanState: 'confirmed' }, {
        utc: runCreatedUtc, actor: 'system', type: 'reopened',
        from: 'done', to: 'confirmed', runId: observation.runId,
      }),
      outcome: 'reopened',
    }
  }
  return {
    issue: withEvent(next, { utc: runCreatedUtc, actor: 'system', type: 'repeat', runId: observation.runId }),
    outcome: 'repeat',
  }
}

function createIssue(observation, runCreatedUtc, ambiguous) {
  // A finding the audit refuted needs no human triage, so it opens in the archive rather than
  // the inbox — marked as the audit's doing, not a reviewer's.
  const refuted = observation.bucket === 'refuted'
  return {
    id: issueIdFor(observation),
    class: observation.class,
    path: observation.path,
    line: observation.line,
    title: observation.title,
    severity: observation.severity ?? null,
    humanState: refuted ? 'suppressed' : 'inbox',
    suppressedBy: refuted ? 'audit' : null,
    ambiguous,
    fingerprints: [observation.fingerprint],
    observations: [{
      runId: observation.runId,
      observationId: observation.observationId,
      fingerprint: observation.fingerprint,
    }],
    evidence: { [observation.observationId]: observation },
    firstSeenRunId: observation.runId,
    lastSeenRunId: observation.runId,
    lastHumanUtc: null,
    events: [{
      utc: runCreatedUtc, actor: 'system',
      type: refuted ? 'refuted-by-audit' : 'observed',
      runId: observation.runId,
    }],
  }
}

export function ingestRun(store, importedRun) {
  if (importedRun.status !== 'ok') return { store, outcomes: [] }
  const seen = new Set()
  for (const issue of store.issues) {
    for (const o of issue.observations) seen.add(seenKey(o.runId, o.observationId))
  }
  let issues = store.issues
  const outcomes = []
  for (const observation of importedRun.observations) {
    const key = seenKey(observation.runId, observation.observationId)
    if (seen.has(key)) continue
    seen.add(key)
    const { issue: match, ambiguous } = findMatch(issues, observation)
    if (!match) {
      const created = createIssue(observation, importedRun.createdUtc, ambiguous)
      issues = [...issues, created]
      outcomes.push({
        observationId: observation.observationId,
        issueId: created.id,
        outcome: ambiguous ? 'ambiguous' : created.humanState === 'suppressed' ? 'refuted' : 'new',
      })
      continue
    }
    const { issue: updated, outcome } = attach(match, observation, importedRun.createdUtc)
    const flagged = ambiguous ? { ...updated, ambiguous: true } : updated
    issues = issues.map(i => (i.id === match.id ? flagged : i))
    outcomes.push({
      observationId: observation.observationId,
      issueId: match.id,
      outcome: ambiguous ? 'ambiguous' : outcome,
    })
  }
  const alreadyRecorded = store.importedRuns.some(r => r.runId === importedRun.runId)
  if (outcomes.length === 0 && alreadyRecorded) return { store, outcomes }
  const importedRuns = alreadyRecorded ? store.importedRuns : [...store.importedRuns, {
    runId: importedRun.runId,
    createdUtc: importedRun.createdUtc,
    importedUtc: importedRun.createdUtc,
    observationCount: importedRun.observations.length,
  }]
  return { store: { ...store, issues, importedRuns }, outcomes }
}

export function applyTransition(store, { issueId, action, revision, utc }) {
  if (revision !== store.revision) {
    const err = new Error('the issue store changed since this view was loaded (expected revision '
      + store.revision + ', got ' + revision + '); refresh and retry')
    err.code = 'E_CONFLICT'
    throw err
  }
  const issue = store.issues.find(i => i.id === issueId)
  if (!issue) {
    const err = new Error('no such issue: ' + issueId)
    err.code = 'E_NOT_FOUND'
    throw err
  }
  const to = TRANSITIONS[issue.humanState]?.[action]
  if (!to) {
    const err = new Error('illegal transition: ' + issue.humanState + ' + ' + action)
    err.code = 'E_TRANSITION'
    throw err
  }
  // A human touching the archive takes ownership of it either way: dismissing marks the
  // suppression as theirs (and so absolute), restoring clears it.
  const suppressedBy = to === 'suppressed' ? 'human' : null
  const updated = withEvent({ ...issue, humanState: to, suppressedBy, lastHumanUtc: utc },
    { utc, actor: 'human', type: action, from: issue.humanState, to })
  return { store: { ...store, issues: store.issues.map(i => (i.id === issueId ? updated : i)) } }
}

// v1 stores predate the rule that a finding the AUDIT refuted is archived rather than queued
// for triage, so they hold refuted findings in the inbox. Two guards keep this from doing harm:
// an issue a human has already decided about is never touched (lastHumanUtc is set by
// applyTransition and nothing else), and an issue whose evidence was not retained cannot be
// classified, so it stays exactly where it is rather than being guessed at.
function migrateV1ToV2(store) {
  return {
    ...store,
    issues: store.issues.map(issue => {
      if (issue.humanState !== 'inbox' || issue.lastHumanUtc) return issue
      const last = issue.observations[issue.observations.length - 1]
      const evidence = issue.evidence?.[last?.observationId]
      if (!evidence) return issue
      let bucket
      try {
        bucket = classifyFinding(evidence).bucket
      } catch {
        return issue                      // an unclassifiable record is not a refutation
      }
      if (bucket !== 'refuted') return issue
      return withEvent({ ...issue, humanState: 'suppressed', suppressedBy: 'audit' }, {
        utc: null, actor: 'system', type: 'refuted-by-audit',
        from: 'inbox', to: 'suppressed', migration: 'v1->v2',
      })
    }),
  }
}

// Keyed by the version each migration upgrades FROM. Applied in order, in memory, on every
// read; the result reaches disk the next time something actually mutates the store. Adding a
// shape change means bumping STORE_VERSION and adding one entry here — not writing a new
// shape-sniffing heuristic, and never asking anyone to delete their board.
const MIGRATIONS = new Map([[1, migrateV1ToV2]])

export function migrateStore(store) {
  let current = store
  while (current.storeVersion < STORE_VERSION) {
    const migrate = MIGRATIONS.get(current.storeVersion)
    if (!migrate) {
      throw new Error('no migration from issue store version ' + current.storeVersion)
    }
    current = { ...migrate(current), storeVersion: current.storeVersion + 1 }
  }
  return current
}

export async function readStore(projectRoot) {
  const raw = await readFile(storePath(projectRoot), 'utf8').catch(() => null)
  if (raw == null) return emptyStore()
  const parsed = JSON.parse(raw)
  const version = parsed?.storeVersion
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('unsupported issue store version: ' + version)
  }
  if (version > STORE_VERSION) {
    throw new Error('issue store version ' + version + ' was written by a newer secaudit; '
      + 'upgrade the plugin rather than downgrading the store')
  }
  return migrateStore(parsed)
}

// Atomic and revision-bumping. A caller that read revision N and writes back N is the only
// writer that wins; anyone else gets E_CONFLICT from applyTransition and refreshes.
export async function writeStore(projectRoot, store) {
  const path = storePath(projectRoot)
  await ensureIgnoredDir(dirname(path))
  const next = { ...store, storeVersion: STORE_VERSION, revision: store.revision + 1 }
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
  return next
}

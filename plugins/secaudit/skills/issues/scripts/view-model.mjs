// plugins/secaudit/skills/issues/scripts/view-model.mjs
// A pure projection of the store into what the board shows. No I/O, no dates, no randomness:
// every view is a deterministic function of the store, which is what makes the UI testable
// without a browser.

// Mirrors issue-store.mjs' transition table, which in turn follows the mockup's detail actions
// (output/secaudit-workbench.html:323): the primary action per state, plus False positive
// everywhere except the archive itself. Deriving the buttons from the same rules the store
// enforces is what stops the UI from offering a move that will be rejected on click.
const ALLOWED = {
  inbox: ['confirm', 'false-positive'],
  confirmed: ['done', 'false-positive'],
  done: ['reopen', 'false-positive'],
  suppressed: ['restore'],
}

const SECTIONS = [
  { key: 'location', label: 'Location', from: o => o.path + ':' + o.line },
  { key: 'challenge', label: 'Challenge', from: o => o.challengeReason },
  { key: 'trace', label: 'Trace evidence', from: o => o.traceEvidence },
  { key: 'impact', label: 'Impact', from: o => o.impact },
  { key: 'remediation', label: 'Remediation', from: o => o.remediation },
  { key: 'dynamicTest', label: 'Dynamic test', from: o => o.dynamicTest },
]

// A run's record is read by a human deciding what to look at first, so it leads with the worst
// thing the run found. Severity order is the report contract's own (Critical, High, Medium,
// Low); a finding with no severity — refuted, or awaiting a defect determination — sorts last
// because the audit did not rate it, not because it is harmless. Path and line break ties so
// the order is stable between reads.
const SEVERITY_RANK = new Map([['Critical', 0], ['High', 1], ['Medium', 2], ['Low', 3]])
const severityRank = card => SEVERITY_RANK.get(card.severity) ?? 99

function bySeverity(a, b) {
  const rank = severityRank(a) - severityRank(b)
  if (rank !== 0) return rank
  const path = a.path.toLowerCase().localeCompare(b.path.toLowerCase())
  if (path !== 0) return path
  return (a.line ?? 0) - (b.line ?? 0)
}

function latestObservationRecord(issue) {
  const last = issue.observations[issue.observations.length - 1]
  return { ...last, ...(issue.evidence?.[last.observationId] ?? {}) }
}

export function toCard(issue) {
  return {
    id: issue.id,
    class: issue.class,
    path: issue.path,
    line: issue.line,
    title: issue.title,
    severity: issue.severity,          // null stays null: a missing severity is not invented
    ambiguous: Boolean(issue.ambiguous),
    // 'human' (a reviewer dismissed it) or 'audit' (the audit refuted it); null on the board.
    suppressedBy: issue.humanState === 'suppressed' ? (issue.suppressedBy ?? 'human') : null,
    observationCount: issue.observations.length,
    lastSeenRunId: issue.lastSeenRunId,
    allowedActions: ALLOWED[issue.humanState] ?? [],
  }
}

export function boardView(store) {
  const columns = { inbox: [], confirmed: [], done: [] }
  let archivedCount = 0
  let ambiguousCount = 0
  for (const issue of store.issues) {
    if (issue.ambiguous) ambiguousCount += 1
    if (issue.humanState === 'suppressed') { archivedCount += 1; continue }
    columns[issue.humanState].push(toCard(issue))
  }
  return { revision: store.revision, columns, archivedCount, ambiguousCount }
}

export function archiveView(store) {
  return {
    revision: store.revision,
    cards: store.issues.filter(i => i.humanState === 'suppressed').map(toCard),
  }
}

export function detailView(store, issueId) {
  const issue = store.issues.find(i => i.id === issueId)
  if (!issue) return null
  const latest = latestObservationRecord(issue)
  // Every emitted field, verbatim. An empty field yields NO section rather than an empty one:
  // an invented "Impact: n/a" reads as an audit finding that was never made.
  const sections = SECTIONS
    .map(s => ({ key: s.key, label: s.label, text: s.from(latest) }))
    .filter(s => typeof s.text === 'string' && s.text.trim().length > 0)
  return {
    revision: store.revision,
    issue: { ...issue, latestObservation: latest },
    // Same source as the card's buttons, so the detail can never offer a rejected move either.
    allowedActions: ALLOWED[issue.humanState] ?? [],
    sections,
  }
}

// Newest first: the run someone wants is nearly always the last one. A run id begins with its
// own UTC timestamp, so it is the one key every run has — an unimported run has no createdUtc,
// and mixing the two formats would order them against each other, not by time.
const byNewestFirst = (a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0)

export function runsView(store, discovered) {
  const byId = new Map(store.importedRuns.map(r => [r.runId, r]))
  return {
    runs: discovered.map(d => {
      const imported = byId.get(d.runId)
      return {
        runId: d.runId,
        runDir: d.runDir,
        createdUtc: imported?.createdUtc ?? null,
        status: d.status ?? (imported ? 'imported' : 'not-imported'),
        observationCount: imported?.observationCount ?? 0,
        reason: d.reason ?? null,
      }
    }).sort(byNewestFirst),
  }
}

// The run's own record of what it saw: every observation that run made, regardless of the
// issue's current human state, so a dismissed finding still appears here with its label.
export function runDetailView(store, runId) {
  const imported = store.importedRuns.find(r => r.runId === runId)
  if (!imported) return null
  const cards = []
  let observations = 0
  for (const issue of store.issues) {
    const seen = issue.observations.filter(o => o.runId === runId)
    if (seen.length === 0) continue
    observations += seen.length
    cards.push({ ...toCard(issue), humanState: issue.humanState })
  }
  return {
    revision: store.revision,
    runId,
    facts: {
      scope: imported.scope ?? [],
      checksRun: imported.checksRun ?? null,
      observations,
    },
    cards: cards.sort(bySeverity),
  }
}

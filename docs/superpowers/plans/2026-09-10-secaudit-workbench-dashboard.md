# secaudit Workbench Dashboard Implementation Plan (Part 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the approved Workbench interface from a local, loopback-only server backed by the persistent issue store, so triage decisions made in the browser survive audits, restarts, and reloads.

**Architecture:** A small Node HTTP server with four separated concerns, each independently testable: `http-routes.mjs` (routing, method/origin validation, JSON envelope), `view-model.mjs` (pure store → board/detail projection), `render.mjs` (untrusted-text-safe HTML rendering), and `server.mjs` (binding, static assets, wiring). The UI is a static bundle under `skills/issues/ui/` extracted from the approved prototype; no build step, no CDN, no network at runtime.

**Tech Stack:** Node.js 22+ (`node:http`), ESM, zero runtime dependencies. Browser side is vanilla ES modules — no framework, no bundler. Fonts are bundled locally.

**Spec:** `docs/superpowers/specs/2026-09-10-secaudit-workbench-design.md`

**Visual authority:** `output/secaudit-workbench.html`, SHA-256 `5dc114ce29421c166bbeb11c0153ed1049739b8e277989780aa9ba4d8add5e41`. Verify the hash before reading it (`shasum -a 256 output/secaudit-workbench.html`). It is the authority for spacing, colors, borders, density, and interaction treatment. Its workflow states and activity entries are illustrative fiction and must never be imported as data.

**Fidelity: recreate the whole thing, do not harvest parts of it.** The deliverable is the
approved design reproduced in full — every view, every component, every state, every
interaction the prototype has. It is not a new interface that borrows the prototype's palette
and a few measurements. Anything a user can reach in the prototype must be reachable in
production, looking and behaving the same way.

Exactly three categories may differ, and nothing else:

1. **Data.** The prototype's eleven embedded findings, its workflow states, and its activity
   entries are illustrative. Production reads the real issue store. Layout, density and copy
   structure around that data stay identical.
2. **The theme switch.** The prototype carries `theme === 'workbench'` branches alongside
   `fieldnotes` and the earlier board variants. Workbench is the selected design; the other
   branches are dead and are not ported. Where a branch differs, take the Workbench side.
3. **Exploratory CSS.** Overrides the prototype accumulated while iterating may be collapsed,
   provided the rendered result is unchanged. Restructuring into focused components is expected;
   changing what it looks like is not.

If something in the prototype seems wrong or improvable, it still gets built as approved — then
raised separately. This plan implements a design that has already been signed off, and a
redesign smuggled in during implementation is a redesign nobody approved.

**Depends on:** Part 1 (`2026-09-10-secaudit-run-lifecycle.md`) and Part 2 (`2026-09-10-secaudit-issue-store.md`). The store, its transitions, and `syncProject` already exist and are already tested; this plan adds no matching or lifecycle logic.

## Global Constraints

- Node.js 22 or newer; no new runtime dependencies, server or browser side.
- Bind to `127.0.0.1` only. Never `0.0.0.0`, never a network interface.
- Every mutating request is `POST`, must carry `Origin` matching the server's own origin (or no `Origin` at all, as same-origin `fetch` from a module script does not always send one for same-origin POSTs — validate `Host` in that case), and must carry the `revision` the client last read.
- File access is scoped: the server reads only the selected project root and the run directories registered in its catalog. Any other path is a 403, not a 404 — silently refusing is not the same as refusing.
- Audit content is untrusted. Render it as text: escape on output, never `innerHTML` with report content, never `eval`, no inline event handlers, and a `Content-Security-Policy` header that forbids inline script.
- Fonts (IBM Plex Sans, IBM Plex Mono) ship locally under `skills/issues/ui/fonts/`; the page must render correctly with no network.
- Human state moves only through `applyTransition`. The server never writes `humanState` directly.
- A failed save must roll the card back visibly. A card that appears moved but was not saved is the one failure this feature cannot ship with.

## Interface parity checklist (from the approved design)

These are the items most likely to drift, called out so they get explicit attention. They are a
**floor, not a definition of done** — full reproduction is the requirement, and Task 6 verifies
the complete inventory, not just this list. Copy exact values from the prototype; do not
re-derive them:

- Charcoal and dark green palette; `/sec` teal green, `audit` white. IBM Plex Sans for body, IBM Plex Mono for navigation, labels, IDs, headings, wordmark.
- Sidebar expanded ~212 px, collapsed ~78 px; the `/s` wordmark is the expansion control when collapsed and changes color on hover.
- 18 px SVG line icons for Issues, Runs, False positives, on shared centers and baselines. No Unicode menu glyphs.
- Sidebar labels ~14 px, action text 13 px, report body 15 px. Uppercase labels legible against their background.
- App fills the viewport height. Sidebar and top bar are fixed and never scroll. The three board columns fill the remaining height and each scrolls independently.
- 58 px top bar; logo, collapse control, contextual back control, and workspace name share one vertical center. Back and collapse use the same 28 px chevron-button treatment.
- Back appears only when a parent view exists, and returns to the originating board, archive, or run. No extra "Back to issues" links.
- Slight translucency and blur on the top bar and on sticky section tabs inside details.
- Details span the full available width, meeting sidebar and top bar with no exterior gap, ~24 px internal padding; only the detail content scrolls.
- Runs use full-width cards with a clear card interaction, no detached arrow. Run details span the full width.
- Issue cards are compact, draggable between allowed columns, with equivalent button actions. No diagonal up-arrow decorations.

---

### Task 1: View model — a pure projection of the store

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/view-model.mjs`
- Test: `tests/secaudit/issues-view-model.test.mjs`

**Interfaces:**
- Consumes: `Store` and `Issue` from `issue-store.mjs` (Part 2 Task 5).
- Produces:
  - `boardView(store)` → `{revision, columns: {inbox: Card[], confirmed: Card[], done: Card[]}, archivedCount, ambiguousCount}`
  - `archiveView(store)` → `{revision, cards: Card[]}` — the suppressed issues.
  - `Card = {id, class, path, line, title, severity, ambiguous, observationCount, lastSeenRunId, allowedActions: string[]}`
  - `detailView(store, issueId)` → `{revision, issue, sections}` where `sections` is the ordered list of report sections present on the latest observation, each `{key, label, text}`; a section is omitted entirely when its source field is empty. Text is returned verbatim, never truncated or summarized.
  - `runsView(store, discovered)` → `{runs: Array<{runId, runDir, createdUtc, status, observationCount, reason}>}` — merges the store's `importedRuns` with the discovery list so unavailable runs appear with their reason.
  - `runDetailView(store, runId)` → `{revision, runId, facts: {scope, checksRun, observations}, cards: Card[]} | null` — the mockup's `runDetail` (`output/secaudit-workbench.html:324`) renders a date title, a `run-facts` list of Scope / Checks run / Observations, then that run's observations as ordinary issue cards. It lists every observation the run made **regardless of the issue's current human state**, so a dismissed finding does appear here, carrying its workflow label. That is the run's record of what it saw, not the actionable board.

`allowedActions` is derived from the same transition table the store enforces, so a button never
appears for a move the store will reject.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-view-model.test.mjs
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { emptyStore, ingestRun, applyTransition } = await import(join(scripts, 'issue-store.mjs'))
const { boardView, archiveView, detailView, runsView } = await import(join(scripts, 'view-model.mjs'))

const observation = (over = {}) => ({
  observationId: 'o1', runId: 'r1', class: 'sqli', path: 'a.py', line: 4,
  title: 'SQL injection in get_order', severity: 'High', challengeVerdict: 'DEFECT',
  challengeReason: 'String concatenation reaches the driver.', traceVerdict: 'REACHABLE',
  traceEvidence: 'POST /orders to handler', impact: 'Full table read.',
  remediation: 'Use a parameterized query.', dynamicTest: null,
  fingerprint: 'fp1:' + '1'.repeat(24), fingerprintKind: 'anchor', ...over,
})

let store = ingestRun(emptyStore(), {
  runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok', observations: [observation()],
}).store

const board = boardView(store)
assert.equal(board.columns.inbox.length, 1)
assert.equal(board.columns.confirmed.length, 0)
assert.equal(board.columns.done.length, 0)
assert.equal(board.revision, store.revision)
// Only the moves the store will accept are offered.
assert.deepEqual(board.columns.inbox[0].allowedActions.sort(), ['confirm', 'false-positive'])

const id = store.issues[0].id
const detail = detailView(store, id)
const keys = detail.sections.map(s => s.key)
assert.deepEqual(keys, ['location', 'challenge', 'trace', 'impact', 'remediation'])
// Absent optional sections are omitted, never invented, and present text is verbatim.
assert.ok(!keys.includes('dynamicTest'))
assert.equal(detail.sections.find(s => s.key === 'remediation').text,
  'Use a parameterized query.')
// The audit verdict stays visible and separate from human state.
assert.equal(detail.issue.humanState, 'inbox')
assert.equal(detail.issue.latestObservation.challengeVerdict, 'DEFECT')

// A dynamic test appears only when the record carries one.
const withTest = ingestRun(emptyStore(), {
  runId: 'r9', runDir: '/x/r9', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok',
  observations: [observation({ dynamicTest: 'GET /orders/999 as another account' })],
}).store
assert.ok(detailView(withTest, withTest.issues[0].id).sections.some(s => s.key === 'dynamicTest'))

// Suppressed issues leave the board for the archive and keep their evidence.
store = applyTransition(store, { issueId: id, action: 'false-positive',
  revision: store.revision, utc: '2026-01-02T00:00:00Z' }).store
assert.equal(boardView(store).columns.inbox.length, 0)
assert.equal(boardView(store).archivedCount, 1)
const archived = archiveView(store)
assert.equal(archived.cards.length, 1)
assert.deepEqual(archived.cards[0].allowedActions, ['restore'])

// Runs merge discovery with import state so an unavailable run is visible, with its reason.
const runs = runsView(store, [
  { runId: 'r1', runDir: '/x/r1' },
  { runId: 'r2', runDir: '/x/r2', status: 'unavailable', reason: 'no report-data.json' },
])
assert.equal(runs.runs.length, 2)
assert.equal(runs.runs.find(r => r.runId === 'r2').status, 'unavailable')
assert.match(runs.runs.find(r => r.runId === 'r2').reason, /report-data/)

console.log('issues-view-model: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-view-model.test.mjs`
Expected: FAIL — cannot find module `view-model.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/view-model.mjs
// A pure projection of the store into what the board shows. No I/O, no dates, no randomness:
// every view is a deterministic function of the store, which is what makes the UI testable
// without a browser.

// Mirrors issue-store.mjs' transition table. Deriving the buttons from the same rules the store
// enforces is what stops the UI from offering a move that will be rejected on click.
// Mirrors issue-store.mjs' transition table, which in turn follows the mockup's detail actions
// (output/secaudit-workbench.html:323): the primary action per state, plus False positive
// everywhere except the archive itself.
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

function latestObservationRecord(store, issue) {
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
  const latest = latestObservationRecord(store, issue)
  // Every emitted field, verbatim. An empty field yields NO section rather than an empty one:
  // an invented "Impact: n/a" reads as an audit finding that was never made.
  const sections = SECTIONS
    .map(s => ({ key: s.key, label: s.label, text: s.from(latest) }))
    .filter(s => typeof s.text === 'string' && s.text.trim().length > 0)
  return {
    revision: store.revision,
    issue: { ...issue, latestObservation: latest },
    sections,
  }
}

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
    }),
  }
}
```

Note the `latestObservationRecord` helper reads full evidence from `issue.evidence` when the
store carries it. Part 2's store keeps only observation references, so extend `attach` and
`createIssue` in `issue-store.mjs` to also record the full observation under
`issue.evidence[observationId]`, and add an assertion to `tests/secaudit/issues-store.test.mjs`
that the field survives a round trip:

```js
assert.equal(store.issues[0].evidence[store.issues[0].observations[0].observationId].title,
  'SQL injection')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-view-model.test.mjs && node tests/secaudit/issues-store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/view-model.mjs \
        plugins/secaudit/skills/issues/scripts/issue-store.mjs \
        tests/secaudit/issues-view-model.test.mjs tests/secaudit/issues-store.test.mjs
git commit -m "feat(secaudit): pure view model for the workbench board, archive, detail and runs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: HTTP routes with origin and revision enforcement

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/http-routes.mjs`
- Test: `tests/secaudit/issues-http-routes.test.mjs`

**Interfaces:**
- Consumes: `boardView`, `archiveView`, `detailView`, `runsView` (Task 1); `readStore`, `writeStore`, `applyTransition` (Part 2); `syncProject` (Part 2 Task 6).
- Produces:
  - `handleRequest({method, url, headers, body, projectRoot, origin, now})` → `Promise<{status, headers, body}>` — pure with respect to HTTP; the only side effects are store reads and writes.
  - Routes: `GET /api/board`, `GET /api/archive`, `GET /api/issues/:id`, `GET /api/runs`, `GET /api/runs/:runId`, `POST /api/sync`, `POST /api/issues/:id/transition` with body `{action, revision}`.
  - Envelope: success `{ok: true, data}`; failure `{ok: false, error: {code, message}}` with codes `E_CONFLICT` (409), `E_TRANSITION` (422), `E_NOT_FOUND` (404), `E_ORIGIN` (403), `E_METHOD` (405), `E_BAD_REQUEST` (400).

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-http-routes.test.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { emptyStore, ingestRun, readStore, writeStore } =
  await import(join(scripts, 'issue-store.mjs'))
const { handleRequest } = await import(join(scripts, 'http-routes.mjs'))

const projectRoot = mkdtempSync(join(tmpdir(), 'secaudit routes-'))
const origin = 'http://127.0.0.1:7777'

const seeded = ingestRun(emptyStore(), {
  runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok',
  observations: [{
    observationId: 'o1', runId: 'r1', class: 'sqli', path: 'a.py', line: 4, title: 'SQLi',
    severity: 'High', challengeVerdict: 'DEFECT', challengeReason: 'concat',
    traceVerdict: 'REACHABLE', traceEvidence: 'route', impact: 'i', remediation: 'r',
    dynamicTest: null, fingerprint: 'fp1:' + '1'.repeat(24), fingerprintKind: 'anchor',
  }],
}).store
await writeStore(projectRoot, seeded)

const call = (method, url, { body, headers = {} } = {}) => handleRequest({
  method, url, headers: { origin, ...headers }, body, projectRoot, origin,
  now: '2026-02-01T00:00:00Z',
})

// Board read.
const board = await call('GET', '/api/board')
assert.equal(board.status, 200)
const boardBody = JSON.parse(board.body)
assert.equal(boardBody.ok, true)
assert.equal(boardBody.data.columns.inbox.length, 1)

const id = boardBody.data.columns.inbox[0].id
const revision = boardBody.data.revision

// A GET may not mutate.
assert.equal((await call('GET', `/api/issues/${id}/transition`)).status, 405)

// Foreign origins are refused outright.
const foreign = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'confirm', revision }),
  headers: { origin: 'http://evil.example' },
})
assert.equal(foreign.status, 403)
assert.equal(JSON.parse(foreign.body).error.code, 'E_ORIGIN')

// A stale revision is a conflict, and the response hands back the current board so the client
// can refresh rather than overwrite a newer decision.
const stale = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'confirm', revision: revision - 1 }),
})
assert.equal(stale.status, 409)
const staleBody = JSON.parse(stale.body)
assert.equal(staleBody.error.code, 'E_CONFLICT')
assert.equal(staleBody.error.currentRevision, (await readStore(projectRoot)).revision)

// An illegal move is refused without touching the store.
const illegal = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'done', revision }),
})
assert.equal(illegal.status, 422)
assert.equal((await readStore(projectRoot)).issues[0].humanState, 'inbox')

// The legal move persists and returns the new revision.
const ok = await call('POST', `/api/issues/${id}/transition`, {
  body: JSON.stringify({ action: 'confirm', revision }),
})
assert.equal(ok.status, 200)
const persisted = await readStore(projectRoot)
assert.equal(persisted.issues[0].humanState, 'confirmed')
assert.equal(JSON.parse(ok.body).data.revision, persisted.revision)

// Unknown issue and unknown route.
assert.equal((await call('GET', '/api/issues/iss_nope')).status, 404)
assert.equal((await call('GET', '/api/nothing')).status, 404)

console.log('issues-http-routes: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-http-routes.test.mjs`
Expected: FAIL — cannot find module `http-routes.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/http-routes.mjs
// Routing and request validation only. Every mutation goes through issue-store's applyTransition
// so the UI can never reach a state the store would refuse, and a conflicting write loses
// rather than silently overwriting a newer human decision.
import { readStore, writeStore, applyTransition } from './issue-store.mjs'
import { boardView, archiveView, detailView, runsView, runDetailView } from './view-model.mjs'
import { discoverRuns } from './run-catalog.mjs'
import { syncProject } from './sync.mjs'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

const ok = (data, status = 200) => ({ status, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, data }) })
const fail = (status, code, message, extra = {}) => ({
  status,
  headers: JSON_HEADERS,
  body: JSON.stringify({ ok: false, error: { code, message, ...extra } }),
})

const STATUS_FOR = { E_CONFLICT: 409, E_TRANSITION: 422, E_NOT_FOUND: 404 }

// A browser omits Origin on some same-origin requests, so Host is the fallback check. Anything
// that names a different origin is refused: this server holds a triage record for one project
// and has no reason to accept a cross-site write.
function sameOrigin(headers, origin) {
  const sent = headers.origin ?? headers.Origin
  if (sent) return sent === origin
  const host = headers.host ?? headers.Host
  return Boolean(host) && origin.endsWith('//' + host)
}

export async function handleRequest({ method, url, headers = {}, body, projectRoot, origin, now }) {
  const path = url.split('?')[0]
  const transition = /^\/api\/issues\/([A-Za-z0-9_]+)\/transition$/.exec(path)
  const detail = /^\/api\/issues\/([A-Za-z0-9_]+)$/.exec(path)

  if (method === 'GET') {
    if (transition) return fail(405, 'E_METHOD', 'a transition must be POSTed')
    const store = await readStore(projectRoot)
    if (path === '/api/board') return ok(boardView(store))
    if (path === '/api/archive') return ok(archiveView(store))
    if (path === '/api/runs') return ok(runsView(store, await discoverRuns(projectRoot)))
    const runDetail = /^\/api\/runs\/([A-Za-z0-9_.-]+)$/.exec(path)
    if (runDetail) {
      const view = runDetailView(store, runDetail[1])
      return view ? ok(view) : fail(404, 'E_NOT_FOUND', 'no such run: ' + runDetail[1])
    }
    if (detail) {
      const view = detailView(store, detail[1])
      return view ? ok(view) : fail(404, 'E_NOT_FOUND', 'no such issue: ' + detail[1])
    }
    return fail(404, 'E_NOT_FOUND', 'no such route: ' + path)
  }

  if (method !== 'POST') return fail(405, 'E_METHOD', 'unsupported method: ' + method)
  if (!sameOrigin(headers, origin)) {
    return fail(403, 'E_ORIGIN', 'refusing a request from another origin')
  }

  if (path === '/api/sync') {
    const { store, summary, unavailable } = await syncProject(projectRoot)
    return ok({ revision: store.revision, summary, unavailable, board: boardView(store) })
  }

  if (!transition) return fail(404, 'E_NOT_FOUND', 'no such route: ' + path)

  let payload
  try {
    payload = JSON.parse(body ?? '')
  } catch {
    return fail(400, 'E_BAD_REQUEST', 'the request body must be JSON')
  }
  if (typeof payload?.action !== 'string' || !Number.isInteger(payload.revision)) {
    return fail(400, 'E_BAD_REQUEST', 'action (string) and revision (integer) are required')
  }

  const store = await readStore(projectRoot)
  try {
    const { store: next } = applyTransition(store, {
      issueId: transition[1], action: payload.action, revision: payload.revision, utc: now,
    })
    const written = await writeStore(projectRoot, next)
    return ok({ revision: written.revision, board: boardView(written) })
  } catch (err) {
    const status = STATUS_FOR[err.code] ?? 500
    // A conflict hands back the current revision AND board so the client refreshes to the
    // newer decision instead of retrying its stale one.
    const extra = err.code === 'E_CONFLICT'
      ? { currentRevision: store.revision, board: boardView(store) }
      : {}
    return fail(status, err.code ?? 'E_UNEXPECTED', err.message, extra)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-http-routes.test.mjs`
Expected: PASS — `issues-http-routes: ok`

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/http-routes.mjs tests/secaudit/issues-http-routes.test.mjs
git commit -m "feat(secaudit): dashboard HTTP routes with origin and revision enforcement

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Loopback server and scoped static assets

**Files:**
- Create: `plugins/secaudit/skills/issues/scripts/server.mjs`
- Create: `plugins/secaudit/skills/issues/ui/index.html` (placeholder in this task, filled in Task 4)
- Test: `tests/secaudit/issues-server.test.mjs`

**Interfaces:**
- Consumes: `handleRequest` (Task 2).
- Produces:
  - `startServer({projectRoot, port = 0})` → `Promise<{url, port, close()}>`
  - CLI: `node server.mjs --project <path> [--port <n>]` prints one JSON line `{url}` and stays running.
  - Static assets are served only from `skills/issues/ui/`; any path that escapes it is 403.
  - Every response carries `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff`.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-server.test.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { startServer } = await import(join(scripts, 'server.mjs'))

const projectRoot = mkdtempSync(join(tmpdir(), 'secaudit server-'))
const server = await startServer({ projectRoot, port: 0 })

try {
  // Loopback only.
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/)

  const page = await fetch(server.url + '/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')

  // The API answers.
  const board = await (await fetch(server.url + '/api/board')).json()
  assert.equal(board.ok, true)

  // Path traversal out of the UI directory is refused, and refused visibly.
  const escaped = await fetch(server.url + '/../scripts/server.mjs')
  assert.ok([403, 404].includes(escaped.status))
  const encoded = await fetch(server.url + '/%2e%2e/scripts/server.mjs')
  assert.ok([403, 404].includes(encoded.status))
  assert.ok(!(await encoded.text()).includes('startServer'))

  // A cross-origin write is refused.
  const foreign = await fetch(server.url + '/api/issues/iss_x/transition', {
    method: 'POST',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'confirm', revision: 0 }),
  })
  assert.equal(foreign.status, 403)
} finally {
  await server.close()
}

console.log('issues-server: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-server.test.mjs`
Expected: FAIL — cannot find module `server.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// plugins/secaudit/skills/issues/scripts/server.mjs
// A local triage board, not a service. It binds to loopback, serves one fixed asset directory,
// and speaks to exactly one project's store. Nothing here is designed to be exposed.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname, extname, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { handleRequest } from './http-routes.mjs'

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui')

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; "
  + "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
])

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// Decode first, then normalize, then prove the result is still inside UI_DIR. Checking for '..'
// in the raw URL misses '%2e%2e', and checking after join misses nothing — so check after join.
function resolveAsset(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const rel = normalize(decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''))
  const abs = join(UI_DIR, rel)
  return abs === UI_DIR || abs.startsWith(UI_DIR + sep) ? abs : null
}

export async function startServer({ projectRoot, port = 0 }) {
  const server = createServer((req, res) => {
    void (async () => {
      const origin = 'http://127.0.0.1:' + server.address().port
      const path = (req.url ?? '/').split('?')[0]

      if (path.startsWith('/api/')) {
        const result = await handleRequest({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: req.method === 'POST' ? await readBody(req) : undefined,
          projectRoot,
          origin,
          now: new Date().toISOString(),
        })
        res.writeHead(result.status, { ...SECURITY_HEADERS, ...result.headers })
        res.end(result.body)
        return
      }

      const asset = resolveAsset(path)
      if (!asset) {
        res.writeHead(403, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
        res.end('refused: that path is outside the dashboard asset directory')
        return
      }
      const content = await readFile(asset).catch(() => null)
      if (content == null) {
        res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': TYPES.get(extname(asset).toLowerCase()) ?? 'application/octet-stream',
      })
      res.end(content)
    })().catch(err => {
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      res.end('internal error: ' + err.message)
    })
  })

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  const bound = server.address().port
  return {
    url: 'http://127.0.0.1:' + bound,
    port: bound,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function parseArgs(argv) {
  const options = { port: 0 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') options.project = argv[++i]
    else if (argv[i] === '--port') options.port = Number(argv[++i])
    else throw new Error('server: unknown argument ' + argv[i])
  }
  if (!options.project) throw new Error('server: --project <path> is required')
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { project, port } = parseArgs(process.argv.slice(2))
  startServer({ projectRoot: project, port })
    .then(({ url }) => console.log(JSON.stringify({ url })))
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}
```

Create `plugins/secaudit/skills/issues/ui/index.html` with a minimal placeholder so the test can
load it; Task 4 replaces its contents:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>secaudit workbench</title></head>
  <body><div id="app"></div><script type="module" src="./app.js"></script></body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-server.test.mjs`
Expected: PASS — `issues-server: ok`

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/scripts/server.mjs plugins/secaudit/skills/issues/ui/index.html \
        tests/secaudit/issues-server.test.mjs
git commit -m "feat(secaudit): loopback dashboard server with scoped assets and a strict CSP

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The Workbench shell — sidebar, top bar, three scrolling columns

**Files:**
- Create: `plugins/secaudit/skills/issues/ui/index.html`, `ui/app.css`, `ui/app.js`, `ui/icons.js`
- Create: `plugins/secaudit/skills/issues/ui/fonts/` (IBM Plex Sans + Mono `.woff2`, with the upstream licence file alongside them)
- Test: `tests/secaudit/issues-ui-parity.test.mjs`

**Interfaces:**
- Consumes: `GET /api/board`, `GET /api/archive`, `GET /api/runs`, `GET /api/issues/:id`.
- Produces: a static bundle rendering the approved shell. `app.js` exports nothing; it is the page entry point. `icons.js` exports `ICONS = {issues, runs, falsePositives, chevron}` — each an 18 px SVG string copied from the prototype.

**Reproduction procedure.** Verify the prototype's hash, then read
`output/secaudit-workbench.html` **in full** before writing any of these files. Reading only
the parts that look relevant is how a rebuild turns into a partial imitation: the details that
get dropped are exactly the ones nobody thought to look for.

First, write the inventory. Enumerate, in a scratch file, every view, component, state and
interaction the prototype has — the three board columns and their empty states, the card, the
detail with its section nav and workflow history, the run list card, the run detail with its
`run-facts`, the false-positives view and its intro line, the sidebar expanded and collapsed,
the top bar with its wordmark/collapse/back/workspace row, the search field, the status
message line, hover and focus treatments, the drag affordances. Take Workbench's side wherever
`theme` branches. That inventory is the task's definition of done and the checklist Task 6
walks; the parity list at the top of this plan is a subset of it.

Then reproduce each entry, copying the prototype's own values — CSS custom properties, the
sidebar and top-bar measurements, the icon SVG markup, the card, register, detail, report and
run-facts layout rules, the exact label and copy strings. Restructure into focused components as
you go; do not restyle. Leave behind only the three categories named under **Fidelity** above.

Anything you cannot reproduce faithfully is a question for the user, not a place to improvise a
substitute.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-ui-parity.test.mjs
// Guards the measurable half of the approved design. The visual half is checked by hand in
// Task 6 against output/secaudit-workbench.html — this file catches silent drift in the
// numbers and in the non-negotiable security properties of the page.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const ui = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'ui')
const css = readFileSync(join(ui, 'app.css'), 'utf8')
const html = readFileSync(join(ui, 'index.html'), 'utf8')
const js = readFileSync(join(ui, 'app.js'), 'utf8')

// Approved measurements.
assert.match(css, /--sidebar-width:\s*212px/)
assert.match(css, /--sidebar-collapsed-width:\s*78px/)
assert.match(css, /--topbar-height:\s*58px/)
assert.match(css, /--detail-padding:\s*24px/)
assert.match(css, /--chevron-size:\s*28px/)

// Full-height shell with independently scrolling columns and a fixed chrome.
assert.match(css, /height:\s*100(vh|dvh)/)
assert.match(css, /\.column-body\s*\{[^}]*overflow-y:\s*auto/)

// Fonts are local: the page must work offline, and must not phone out for a webfont.
assert.ok(!/fonts\.googleapis|fonts\.gstatic|https?:\/\//.test(css),
  'app.css must not reference any remote resource')
assert.match(css, /@font-face[\s\S]*IBM Plex Sans[\s\S]*\.\/fonts\//)
assert.match(css, /@font-face[\s\S]*IBM Plex Mono[\s\S]*\.\/fonts\//)

// No inline script and no inline handlers: the CSP forbids them, so a regression here is a
// blank page rather than a subtle bug.
assert.ok(!/<script(?![^>]*src=)/.test(html), 'index.html must not contain inline script')
assert.ok(!/\son[a-z]+=/i.test(html), 'index.html must not use inline event handlers')

// Audit content is never injected as markup.
assert.ok(!/innerHTML\s*=/.test(js), 'app.js must not assign innerHTML for report content')
assert.ok(!/\beval\(|new Function\(/.test(js), 'app.js must not evaluate strings')

console.log('issues-ui-parity: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-ui-parity.test.mjs`
Expected: FAIL — `app.css` does not exist.

- [ ] **Step 3: Write minimal implementation**

`ui/index.html` — the shell only; every region is filled by `app.js`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>secaudit workbench</title>
    <link rel="stylesheet" href="./app.css">
  </head>
  <body>
    <div class="shell">
      <nav class="sidebar" id="sidebar" aria-label="Views"></nav>
      <header class="topbar" id="topbar"></header>
      <main class="content" id="content" tabindex="-1"></main>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
```

`ui/app.css` — declare the approved values as custom properties at the top, then lay out the
shell with a grid whose chrome does not scroll:

```css
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('./fonts/IBMPlexSans-Regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('./fonts/IBMPlexMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}

:root {
  /* Palette copied from output/secaudit-workbench.html — that file is the authority. */
  --charcoal: #1b1d1c;
  --panel: #232624;
  --green-deep: #12281f;
  --teal: #35d6a4;
  --text: #f2f4f3;
  --text-dim: #9aa5a0;
  --border: #2f3532;

  --sidebar-width: 212px;
  --sidebar-collapsed-width: 78px;
  --topbar-height: 58px;
  --detail-padding: 24px;
  --chevron-size: 28px;
  --label-size: 14px;
  --action-size: 13px;
  --body-size: 15px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--charcoal);
  color: var(--text);
  font: 400 var(--body-size)/1.5 'IBM Plex Sans', system-ui, sans-serif;
}

/* The chrome is fixed by construction: only the third grid cell can scroll. */
.shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: var(--topbar-height) 1fr;
  grid-template-areas: 'sidebar topbar' 'sidebar content';
  height: 100dvh;
  overflow: hidden;
}
.shell[data-collapsed='true'] { grid-template-columns: var(--sidebar-collapsed-width) 1fr; }

.sidebar { grid-area: sidebar; overflow: hidden; border-right: 1px solid var(--border); }
.topbar {
  grid-area: topbar;
  display: flex;
  align-items: center;      /* logo, chevrons, and workspace name share one vertical center */
  gap: 12px;
  height: var(--topbar-height);
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--charcoal) 82%, transparent);
  backdrop-filter: blur(8px);
}
.content { grid-area: content; overflow: hidden; min-width: 0; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: var(--label-size);
}
.nav-item svg { width: 18px; height: 18px; flex: none; }

.chevron-button {
  width: var(--chevron-size);
  height: var(--chevron-size);
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-dim);
  cursor: pointer;
}

/* Three columns fill the remaining height; each scrolls on its own. */
.board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; height: 100%; padding: 16px; }
.column { display: flex; flex-direction: column; min-height: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
.column-head { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: var(--action-size); text-transform: uppercase; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.column-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.detail { height: 100%; overflow-y: auto; padding: var(--detail-padding); }
.detail-tabs { position: sticky; top: 0; background: color-mix(in srgb, var(--charcoal) 82%, transparent); backdrop-filter: blur(8px); }
.detail pre { white-space: pre-wrap; word-break: break-word; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
```

`ui/app.js` — state, fetching, and DOM built with `textContent` only:

```js
// The board's client. Two rules run through all of it:
//  - Report content reaches the DOM through textContent, never markup. It is untrusted output
//    from an audit of someone else's repository.
//  - A card only moves after the server confirms the move. An optimistic card that silently
//    failed to save is worse than a slow one.
import { ICONS } from './icons.js'

const state = { view: { name: 'board' }, revision: 0, board: null, stack: [] }

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text     // never innerHTML
  return node
}

function icon(name) {
  const span = el('span', 'icon')
  span.innerHTML = ICONS[name]                  // our own constant markup, never audit content
  return span
}

async function api(path, options) {
  const response = await fetch(path, options)
  const payload = await response.json()
  if (!payload.ok) throw Object.assign(new Error(payload.error.message), payload.error)
  return payload.data
}

function toast(message) {
  const node = document.getElementById('toast')
  node.textContent = message
  node.hidden = false
  setTimeout(() => { node.hidden = true }, 6000)
}

async function transition(issueId, action) {
  try {
    const data = await api(`/api/issues/${issueId}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, revision: state.revision }),
    })
    state.revision = data.revision
    state.board = data.board
  } catch (err) {
    // The move did not persist. Re-render from what the server actually holds so the card
    // visibly returns to where it really is, and say why.
    if (err.board) { state.board = err.board; state.revision = err.currentRevision }
    else await loadBoard()
    toast(err.code === 'E_CONFLICT'
      ? 'Someone else changed this issue; the board has been refreshed.'
      : 'That change was not saved: ' + err.message)
  }
  render()
}

async function loadBoard() {
  const data = await api('/api/board')
  state.revision = data.revision
  state.board = data
}

function renderCard(card) {
  const node = el('article', 'card')
  node.draggable = card.allowedActions.length > 0
  node.dataset.issueId = card.id
  node.append(el('h3', 'card-title', card.title))
  node.append(el('p', 'card-meta',
    [card.class, card.path + (card.line ? ':' + card.line : ''),
      card.severity ?? 'severity not stated'].join(' · ')))
  if (card.ambiguous) node.append(el('p', 'card-flag', 'identity needs a human merge decision'))
  const actions = el('div', 'card-actions')
  for (const action of card.allowedActions) {
    const button = el('button', 'action', action.replace('-', ' '))
    button.type = 'button'
    button.addEventListener('click', () => transition(card.id, action))
    actions.append(button)
  }
  node.append(actions)
  return node
}

const COLUMN_LABELS = { inbox: 'Audit inbox', confirmed: 'Confirmed', done: 'Done' }

function renderBoard() {
  const board = el('div', 'board')
  for (const [key, label] of Object.entries(COLUMN_LABELS)) {
    const cards = state.board.columns[key]
    const column = el('section', 'column')
    column.append(el('h2', 'column-head', label + ' (' + cards.length + ')'))
    const body = el('div', 'column-body')
    for (const card of cards) {
      const node = renderCard(card)
      wireDragAndDrop(node, card, key)
      node.addEventListener('click', () => navigate({ name: 'detail', issueId: card.id }))
      body.append(node)
    }
    wireColumnDrop(body, key)
    column.append(body)
    board.append(column)
  }
  document.getElementById('content').replaceChildren(board)
}

function render() {
  renderTopbar()
  renderSidebar()
  if (state.view.name === 'detail') void renderDetail(state.view.issueId)
  else if (state.view.name === 'archive') void renderArchive()
  else if (state.view.name === 'runs') void renderRuns()
  else renderBoard()
}

await loadBoard()
render()
```

`renderSidebar`, `renderArchive`, and `renderRuns` follow exactly the shape of `renderBoard`:
build nodes, set text with `textContent`, attach listeners with `addEventListener`, and call
`navigate(...)` so Back has a parent to return to. `renderSidebar` renders the three nav items
from `ICONS` and toggles `shell[data-collapsed]`; `renderArchive` lists `GET /api/archive` cards
with their single Restore action; `renderRuns` lists `GET /api/runs` as full-width cards whose
whole surface is the click target, showing an unavailable run's reason inline.

`ui/icons.js` — the four SVGs, copied verbatim from the prototype:

```js
// 18px line icons, copied from output/secaudit-workbench.html. Constant markup owned by this
// file; never interpolate anything into these strings.
export const ICONS = {
  issues: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4">…</svg>',
  runs: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4">…</svg>',
  falsePositives: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4">…</svg>',
  chevron: '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4">…</svg>',
}
```

Replace each `…` with the exact path data from the prototype. Do not draw substitutes.

Download the two font files from the IBM Plex release used by the prototype into `ui/fonts/`,
and place the upstream `LICENSE.txt` beside them; add a line naming IBM Plex and its licence to
`plugins/secaudit/NOTICE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-ui-parity.test.mjs && node tests/secaudit/issues-server.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/ui plugins/secaudit/NOTICE tests/secaudit/issues-ui-parity.test.mjs
git commit -m "feat(secaudit): workbench shell, board columns, and local fonts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Drag, keyboard parity, contextual back, and full evidence detail

**Files:**
- Modify: `plugins/secaudit/skills/issues/ui/app.js`, `ui/app.css`
- Test: `tests/secaudit/issues-ui-parity.test.mjs` (append)

**Interfaces:**
- Consumes: `GET /api/issues/:id` (Task 1's `detailView`), `POST /api/issues/:id/transition`.
- Produces: no new module exports. Behaviour: drag between allowed columns, buttons that do the same thing, a navigation stack driving contextual Back, and a detail view showing every emitted section verbatim.

**Behaviour rules:**
- A drag is only accepted when the target column is reachable from the card's state (`inbox → confirmed`, `confirmed → done`, `done → confirmed`). An inbox card dropped on Done is rejected with the same toast as the API refusal — the rule is not a UI nicety, it is the store's transition table.
- Dragging is optional. Every drag has a button equivalent, buttons are focusable in DOM order, and `Enter`/`Space` activate them.
- Back is rendered only when `state.stack` is non-empty, and pops one level: detail → its originating board/archive/run, nested run view → run detail → run list.
- Detail shows Location, Challenge, Trace evidence, Impact, Remediation, and Dynamic test — only those present — with whitespace and line breaks preserved (`<pre class="…">` with `white-space: pre-wrap`, filled via `textContent`). Nothing is truncated. The audit verdict is displayed next to, and visibly distinct from, the human state.

- [ ] **Step 1: Write the failing test**

Append to `tests/secaudit/issues-ui-parity.test.mjs`:

```js
// Interaction parity: dragging is optional, and the illegal move is refused client-side too.
assert.match(js, /addEventListener\('dragstart'/)
assert.match(js, /addEventListener\('drop'/)
assert.match(js, /ALLOWED_DROPS/, 'the drop rule must be explicit, not inferred at the drop site')
assert.ok(/allowedActions/.test(js), 'buttons must come from the server-provided allowed actions')

// Contextual back only when a parent exists.
assert.match(js, /state\.stack\.length/)
assert.ok(!/Back to issues|Back to run/.test(js), 'no extra literal back links')

// Detail preserves the full text of every present section and invents nothing.
assert.match(js, /white-space|pre-wrap|<pre/i)
assert.ok(!/slice\(0,\s*\d+\)|substring\(/.test(js), 'detail text must never be truncated')
assert.match(css, /white-space:\s*pre-wrap/)

console.log('issues-ui-parity interactions: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-ui-parity.test.mjs`
Expected: FAIL — no `dragstart` listener in `app.js`.

- [ ] **Step 3: Write minimal implementation**

Add to `ui/app.js`:

```js
// The same table the store enforces, restated for the drop target so an illegal drag is
// refused before a request is made — and refused with the same message the API would give.
// Copied from the mockup's canMove (output/secaudit-workbench.html:318): any move among the
// three board columns EXCEPT inbox -> done, which would put a finding in Done that no human
// ever confirmed.
const ALLOWED_DROPS = {
  inbox: { confirmed: 'confirm' },
  confirmed: { inbox: 'reopen', done: 'done' },
  done: { inbox: 'reopen', confirmed: 'confirm' },
}

function wireDragAndDrop(cardNode, card, columnKey) {
  cardNode.addEventListener('dragstart', event => {
    event.dataTransfer.setData('text/plain', JSON.stringify({ id: card.id, from: columnKey }))
    event.dataTransfer.effectAllowed = 'move'
  })
}

function wireColumnDrop(columnNode, toKey) {
  columnNode.addEventListener('dragover', event => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  })
  columnNode.addEventListener('drop', event => {
    event.preventDefault()
    let payload
    try {
      payload = JSON.parse(event.dataTransfer.getData('text/plain'))
    } catch {
      return
    }
    const action = ALLOWED_DROPS[payload.from]?.[toKey]
    if (!action) {
      toast('Nothing reaches Done without a human confirmation first.')
      return
    }
    void transition(payload.id, action)
  })
}
```

Navigation stack and contextual back:

```js
function navigate(view) {
  state.stack.push(state.view)
  state.view = view
  render()
}

function back() {
  if (state.stack.length === 0) return
  state.view = state.stack.pop()
  render()
}

function renderTopbar() {
  const bar = document.getElementById('topbar')
  bar.replaceChildren()
  const wordmark = el('span', 'wordmark')
  wordmark.append(el('span', 'wordmark-sec', '/sec'), el('span', 'wordmark-audit', 'audit'))
  bar.append(wordmark)

  const collapse = el('button', 'chevron-button')
  collapse.type = 'button'
  collapse.setAttribute('aria-label', 'Collapse the sidebar')
  collapse.append(icon('chevron'))
  collapse.addEventListener('click', toggleSidebar)
  bar.append(collapse)

  // Back exists only where a parent view exists — no dead control on a root view.
  if (state.stack.length > 0) {
    const backButton = el('button', 'chevron-button back')
    backButton.type = 'button'
    backButton.setAttribute('aria-label', 'Back')
    backButton.append(icon('chevron'))
    backButton.addEventListener('click', back)
    bar.append(backButton)
  }
  bar.append(el('span', 'workspace', state.workspaceName ?? ''))
}
```

Detail rendering, verbatim and untruncated:

```js
async function renderDetail(issueId) {
  const data = await api('/api/issues/' + issueId)
  const root = el('section', 'detail')

  const header = el('header', 'detail-head')
  header.append(el('h1', 'detail-title', data.issue.title))
  // Audit verdict and human state are different facts and must read as different facts.
  header.append(el('span', 'verdict',
    'Audit: ' + data.issue.latestObservation.challengeVerdict
    + (data.issue.latestObservation.traceVerdict
      ? ' / ' + data.issue.latestObservation.traceVerdict : '')))
  header.append(el('span', 'human-state', 'Board: ' + data.issue.humanState))
  root.append(header)

  for (const section of data.sections) {
    const block = el('section', 'detail-section')
    block.append(el('h2', 'detail-section-title', section.label))
    block.append(el('pre', 'detail-section-body', section.text))  // full text, line breaks kept
    root.append(block)
  }

  // Activity is secondary to the finding itself, so it comes last.
  const activity = el('section', 'detail-activity')
  activity.append(el('h2', 'detail-section-title', 'Activity'))
  for (const event of data.issue.events) {
    activity.append(el('p', 'event',
      [event.utc, event.actor, event.type, event.runId].filter(Boolean).join(' · ')))
  }
  root.append(activity)

  document.getElementById('content').replaceChildren(root)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/secaudit/issues-ui-parity.test.mjs`
Expected: PASS — both `ok` lines.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/ui tests/secaudit/issues-ui-parity.test.mjs
git commit -m "feat(secaudit): drag with button parity, contextual back, and full-evidence detail

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Launch skill, persistence-across-restart test, and the manual parity pass

**Files:**
- Create: `plugins/secaudit/skills/issues/SKILL.md`
- Modify: `plugins/secaudit/README.md`, `.claude-plugin/plugin.json` (if skills are enumerated there — check before editing)
- Test: `tests/secaudit/issues-persistence-e2e.test.mjs`

**Interfaces:**
- Consumes: `startServer` (Task 3), `syncProject` (Part 2).
- Produces: `secaudit:issues` — a skill that syncs the project and starts the dashboard, printing the URL.

- [ ] **Step 1: Write the failing test**

```js
// tests/secaudit/issues-persistence-e2e.test.mjs
// The claim this whole feature rests on: a decision made in the browser is still there after
// the server dies. Anything less and the board is a pretty view of nothing.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const scripts = join(here, '..', '..', 'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { startServer } = await import(join(scripts, 'server.mjs'))
const { syncProject } = await import(join(scripts, 'sync.mjs'))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'report-data.json'), 'utf8'))

const project = mkdtempSync(join(tmpdir(), 'secaudit e2e board-'))
const runDir = join(project, '.secaudit', 'runs', '20260101T000000Z-aaaaaaaa')
mkdirSync(join(runDir, 'work', 'sast'), { recursive: true })
writeFileSync(join(runDir, 'work', 'sast', 'report-data.json'), JSON.stringify({
  ...fixture,
  findings: [{
    ...fixture.findings[0],
    anchor: { version: 1, anchorKind: 'decl', anchorName: 'h',
      codeHash: '1'.repeat(16), fingerprint: 'fp1:' + '1'.repeat(24) },
  }],
}), 'utf8')
writeFileSync(join(runDir, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 2, runId: '20260101T000000Z-aaaaaaaa',
  target: project, state: 'complete', createdUtc: '2026-01-01T00:00:00Z', scope: [],
}), 'utf8')

await syncProject(project)

let server = await startServer({ projectRoot: project, port: 0 })
let board = (await (await fetch(server.url + '/api/board')).json()).data
const id = board.columns.inbox[0].id

const move = async (action, revision) => (await (await fetch(
  `${server.url}/api/issues/${id}/transition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: server.url },
    body: JSON.stringify({ action, revision }),
  })).json())

let result = await move('confirm', board.revision)
assert.equal(result.ok, true)
result = await move('done', result.data.revision)
assert.equal(result.data.board.columns.done.length, 1)
await server.close()

// Restart: the decision survived the process.
server = await startServer({ projectRoot: project, port: 0 })
board = (await (await fetch(server.url + '/api/board')).json()).data
assert.equal(board.columns.done.length, 1)
assert.equal(board.columns.inbox.length, 0)

// A repeat observation of a done issue reopens it into Confirmed, not into the inbox.
const secondRun = join(project, '.secaudit', 'runs', '20260201T000000Z-bbbbbbbb')
mkdirSync(join(secondRun, 'work', 'sast'), { recursive: true })
writeFileSync(join(secondRun, 'work', 'sast', 'report-data.json'),
  readFileSync(join(runDir, 'work', 'sast', 'report-data.json'), 'utf8'), 'utf8')
writeFileSync(join(secondRun, 'secaudit-run.json'), JSON.stringify({
  marker: 'secaudit-run', formatVersion: 2, runId: '20260201T000000Z-bbbbbbbb',
  target: project, state: 'complete', createdUtc: '2026-02-01T00:00:00Z', scope: [],
}), 'utf8')

const synced = await (await fetch(server.url + '/api/sync', {
  method: 'POST', headers: { origin: server.url },
})).json()
assert.equal(synced.data.summary.reopened, 1)
assert.equal(synced.data.board.columns.confirmed.length, 1)
assert.equal(synced.data.board.columns.inbox.length, 0)

await server.close()
console.log('issues-persistence-e2e: ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/secaudit/issues-persistence-e2e.test.mjs`
Expected: FAIL until Tasks 1–3 are merged; PASS afterwards with no production change. A failure
after that is a real defect — fix the module, not the test.

- [ ] **Step 3: Write the launch skill**

Create `plugins/secaudit/skills/issues/SKILL.md`:

```markdown
---
name: issues
description: >-
  Open the secaudit Workbench: sync the persistent issue board with every
  discoverable run in this project, then serve it locally so triage decisions
  (confirm, done, false positive) persist across audits and restarts.
disable-model-invocation: true
argument-hint: "[project-path]"
---

# secaudit:issues — open the Workbench

## Step 0 — preflight Node

Run `node --version`. If it fails or reports a major version below 22, STOP and tell the user
secaudit requires Node.js 22 or newer on PATH. Do not work around it.

## Step 0b — resolve PLUGIN_ROOT

PLUGIN_ROOT is `${CLAUDE_PLUGIN_ROOT}` in Claude Code; in any other client it is the directory
two levels above this file. Quote it — the plugin may be installed under a path containing
spaces. Never substitute the audited project for it.

## Step 1 — resolve the project

The project is the directory holding `.secaudit`. If the user gave a path, use it. Otherwise use
the Git toplevel above the current directory, else the current directory. Show the resolved path
before doing anything else.

## Step 2 — sync

```
node "<PLUGIN_ROOT>/skills/issues/scripts/sync.mjs" --project "<project>"
```

Report `summary` verbatim: `new`, `repeat`, `reopened`, `suppressed`, `ambiguous`. A `repeat` is
not a new finding. Name every `unavailable` run and its reason.

## Step 3 — serve

```
node "<PLUGIN_ROOT>/skills/issues/scripts/server.mjs" --project "<project>"
```

It prints `{"url":"http://127.0.0.1:<port>"}`. Give the user the URL. The server binds to
loopback only and serves one project. Tell the user to stop it with Ctrl-C when finished.

## What the board does and does not do

- Human decisions are the only thing that moves a card. An audit verdict of DEFECT is not a
  human confirmation.
- A finding a human marked a false positive is archived and never raised again by a later audit.
  Only an explicit Restore returns it to the inbox.
- A finding that stops appearing is NOT marked done: scope and coverage differ between runs.
- Historical reports are unchanged by anything done on the board.
```

Add a short section to `plugins/secaudit/README.md` describing `secaudit:issues`, the loopback
binding, and where the store lives (`<project>/.secaudit/issues.json`). Check whether
`.claude-plugin/plugin.json` enumerates skills; if it does, add `issues` there and re-run
`node tests/secaudit/validate-manifests.test.mjs`.

- [ ] **Step 4: Run the full suite and the manual parity pass**

```bash
for t in tests/*/*.test.mjs; do echo "--- $t"; node "$t" || exit 1; done
claude plugin validate . --strict
```

Then, by hand, with the server running against a project that has real runs, walk the **full
inventory written in Task 4** — every view, component, state and interaction, not only the
parity checklist at the top of this plan — against `output/secaudit-workbench.html` open side by
side, at a desktop width and at a narrow one. Anything present in the prototype and missing,
restyled, or reworded in production is a defect to fix, not a variance to note. Also verify:

- Expanded and collapsed sidebar both keep icons and labels aligned on shared centers and baselines.
- The three columns scroll independently while the sidebar and top bar stay put.
- A finding with very long evidence scrolls inside the detail pane only; the shell does not move.
- Every drag has a working button equivalent, reachable and activatable by keyboard alone.
- Stopping the server mid-drag, then retrying the same move, produces the failure toast and leaves the card where it really is.

Record the result of this pass in the PR description. It is the only verification of the visual
half of the design, and it is required — the automated tests deliberately cover only the
measurable half.

- [ ] **Step 5: Commit**

```bash
git add plugins/secaudit/skills/issues/SKILL.md plugins/secaudit/README.md \
        .claude-plugin/plugin.json tests/secaudit/issues-persistence-e2e.test.mjs
git commit -m "feat(secaudit): secaudit:issues launch skill and persistence end-to-end test

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Out of scope

No hosted service, accounts, external issue-tracker integration, automatic remediation,
automatic human confirmation, or automatic resolution from absence. The prototype's illustrative
workflow decisions and activity entries are never imported.

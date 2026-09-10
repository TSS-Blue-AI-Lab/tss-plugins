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

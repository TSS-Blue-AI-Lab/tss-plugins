// The Workbench client. Two rules run through all of it:
//  - Report content reaches the DOM through textContent, never markup. It is untrusted output
//    from an audit of someone else's repository.
//  - A card only moves after the server confirms the move. An optimistic card that silently
//    failed to save is worse than a slow one.
// Structure, class names and copy come from the approved prototype
// (output/secaudit-workbench.html); the data behind them is the real issue store.
import { ICONS } from './icons.js'

const LABELS = {
  inbox: 'Audit inbox',
  confirmed: 'Human confirmed',
  done: 'Done',
  suppressed: 'False positive',
}
const NOTES = {
  inbox: 'Awaiting your review',
  confirmed: 'Ready to resolve',
  done: 'Resolved by a reviewer',
}
const PAGES = [
  { page: 'board', label: 'Issues', icon: 'board' },
  { page: 'runs', label: 'Runs', icon: 'runs' },
  { page: 'falsepositives', label: 'False positives', icon: 'falsepositives' },
]

const state = { view: { name: 'board' }, stack: [], revision: 0, board: null, query: '' }

const q = selector => document.querySelector(selector)

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text     // never innerHTML
  return node
}

const button = (text, className, onClick) => {
  const node = el('button', className, text)
  node.type = 'button'
  node.addEventListener('click', onClick)
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function icon(name) {
  const spec = ICONS[name]
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', spec.viewBox)
  svg.setAttribute('focusable', 'false')
  for (const shape of spec.shapes) {
    const node = document.createElementNS(SVG_NS, shape.tag)
    for (const [key, value] of Object.entries(shape.attrs)) node.setAttribute(key, value)
    svg.append(node)
  }
  const wrap = el('span', 'nav-icon')
  wrap.setAttribute('aria-hidden', 'true')
  wrap.append(svg)
  return wrap
}

async function api(path, options) {
  const response = await fetch(path, options)
  const payload = await response.json()
  if (!payload.ok) throw Object.assign(new Error(payload.error.message), payload.error)
  return payload.data
}

// The footer status line, which is where the prototype puts every message.
function toast(message) {
  q('#message').textContent = message
}

function goTop() {
  q('#content').scrollTop = 0
}

function navigate(view) {
  state.stack.push(state.view)
  state.view = view
  render()
  goTop()
}

function back() {
  if (state.stack.length === 0) return
  state.view = state.stack.pop()
  render()
  goTop()
}

function openPage(page) {
  state.stack = []
  state.view = { name: page }
  state.query = ''
  q('#search').value = ''
  toast('')
  render()
  goTop()
}

async function loadBoard() {
  const data = await api('/api/board')
  state.revision = data.revision
  state.board = data
}

async function transition(issueId, action) {
  try {
    const data = await api('/api/issues/' + issueId + '/transition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, revision: state.revision }),
    })
    state.revision = data.revision
    state.board = data.board
    toast(issueId + ' → ' + (LABELS[action] ?? action))
  } catch (err) {
    // The move did not persist. Re-render from what the server actually holds so the card
    // visibly returns to where it really is, and say why.
    if (err.board) { state.board = err.board; state.revision = err.currentRevision }
    else await loadBoard().catch(() => {})
    toast(err.code === 'E_CONFLICT'
      ? 'Someone else changed this issue; the board has been refreshed.'
      : 'That change was not saved: ' + err.message)
  }
  render()
}

const matches = card => !state.query
  || (card.id + ' ' + card.title + ' ' + card.path).toLowerCase().includes(state.query)

function issueCard(card, stage) {
  const node = button('', 'issue', () => navigate({ name: 'detail', issueId: card.id }))
  node.dataset.issue = card.id
  node.setAttribute('aria-label', card.title)
  const copy = el('div', 'issue-copy')
  copy.append(
    el('div', 'issue-title', card.title),
    el('div', 'issue-path', card.path + (card.line ? ':' + card.line : '')),
  )
  // A refuted finding, and one awaiting a defect determination, carry severity: null by
  // contract. That cell stays empty rather than holding an invented label — the register's
  // severity column is 67px wide and any stand-in text runs into its neighbours.
  if (card.suppressedBy === 'audit') copy.append(el('div', 'issue-path', 'Refuted by the audit'))
  else if (card.suppressedBy === 'human') copy.append(el('div', 'issue-path', 'Dismissed by a reviewer'))
  if (card.ambiguous) copy.append(el('div', 'issue-path', 'Identity needs a merge decision'))
  node.append(
    el('span', 'issue-id mono', card.id),
    copy,
    el('span', 'issue-class', card.class),
    card.severity
      ? el('span', 'severity' + (card.severity === 'High' ? ' high' : ''), card.severity)
      : el('span', 'severity-empty'),
  )
  wireDragAndDrop(node, card, stage)
  return node
}

function lane(stage, cards) {
  const section = el('section', 'lane')
  section.dataset.stage = stage
  const heading = el('div', 'lane-heading')
  const title = el('h2')
  title.append(el('span', 'state-dot ' + stage), document.createTextNode(LABELS[stage]))
  heading.append(title, el('span', 'count', String(cards.length)))
  if (NOTES[stage]) heading.append(el('span', 'lane-note', NOTES[stage]))
  const items = el('div', 'issues column-body')
  for (const card of cards) items.append(issueCard(card, stage))
  if (cards.length === 0) items.append(el('p', 'empty', state.query ? 'No matches' : 'No findings'))
  section.append(heading, items)
  wireColumnDrop(section, items, stage)
  return section
}

function renderBoard() {
  const register = el('div', 'register workflow-board')
  for (const stage of ['inbox', 'confirmed', 'done']) {
    register.append(lane(stage, state.board.columns[stage].filter(matches)))
  }
  q('#content').replaceChildren(register)
}

async function renderArchive() {
  const data = await api('/api/archive')
  state.revision = data.revision
  const content = q('#content')
  content.replaceChildren()
  content.append(el('p', 'intro archive-intro',
    'Findings that need no triage. A reviewer dismissed some of them: those stay out of every '
    + 'future audit inbox, and are suppressed in later reports, until explicitly restored. The '
    + 'audit refuted the rest; if a later run stops refuting one, it returns to the inbox on '
    + 'its own.'))
  const list = el('div', 'register')
  list.append(lane('suppressed', data.cards))
  content.append(list)
}

async function renderRuns() {
  const data = await api('/api/runs')
  const content = q('#content')
  content.replaceChildren()
  if (data.runs.length === 0) {
    content.append(el('p', 'empty', 'No runs discovered in this project yet.'))
    return
  }
  for (const run of data.runs) {
    const available = run.status !== 'unavailable'
    const card = button('', 'run-card', () => {
      if (available) navigate({ name: 'runDetail', runId: run.runId })
    })
    const copy = el('div')
    copy.append(el('h2', '', run.createdUtc ?? run.runId))
    copy.append(el('p', '', available
      ? [run.runId, run.status, run.observationCount + ' observations'].join(' · ')
      : [run.runId, 'unavailable', run.reason].filter(Boolean).join(' · ')))
    card.append(copy, el('span', 'run-open', available ? 'Open assessment' : 'Not imported'))
    content.append(card)
  }
}

function renderSidebar() {
  const nav = q('#project-navigation')
  nav.replaceChildren()
  for (const item of PAGES) {
    const node = button('', '', () => openPage(item.page))
    node.dataset.page = item.page
    if (state.view.name === item.page) node.setAttribute('aria-current', 'page')
    node.append(icon(item.icon), el('span', 'nav-label', item.label))
    nav.append(node)
  }
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed)
  q('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed))
  q('#sidebar-expand').setAttribute('aria-expanded', String(!collapsed))
  q(collapsed ? '#sidebar-expand' : '#sidebar-toggle').focus({ preventScroll: true })
}

const PAGE_TITLES = { board: 'Issue board', runs: 'Audit runs', falsepositives: 'False positives' }
const EYEBROWS = { board: 'WORKSPACE', runs: 'HISTORY', falsepositives: 'REVIEW DECISIONS' }
const SUBTITLES = {
  runs: 'Saved assessments and their original observations',
  falsepositives: 'Human decisions retained across future audits',
}

function renderChrome() {
  const rootPage = ['board', 'runs', 'falsepositives'].includes(state.view.name)
    ? state.view.name
    : (state.stack.find(v => ['board', 'runs', 'falsepositives'].includes(v.name))?.name ?? 'board')
  // Back exists only where a parent view exists — no dead control on a root view.
  const canGoBack = state.stack.length > 0
  q('#workspace-back').hidden = !canGoBack
  q('#workspace-back').disabled = !canGoBack
  document.body.classList.toggle('board-view', state.view.name === 'board')
  document.body.classList.toggle('detail-view',
    state.view.name === 'detail' || state.view.name === 'runDetail')
  q('#titlebar').hidden = !['board', 'runs', 'falsepositives'].includes(state.view.name)
  q('#search-wrap').hidden = state.view.name !== 'board'
  q('#page-title').textContent = PAGE_TITLES[rootPage]
  q('#eyebrow').textContent = 'SECAUDIT / ' + EYEBROWS[rootPage]
  const counts = state.board
    ? Object.values(state.board.columns).reduce((n, cards) => n + cards.length, 0)
    : 0
  q('#subtitle').textContent = rootPage === 'board'
    ? counts + ' issues · ' + (state.board?.columns.inbox.length ?? 0) + ' awaiting review'
    : SUBTITLES[rootPage]
  q('#project-name').textContent = state.board?.projectName ?? ''
  q('#header-context').textContent = state.board
    ? 'Revision ' + state.revision + ' · ' + (state.board.archivedCount) + ' archived'
    : ''
  renderSidebar()
}

function render() {
  renderChrome()
  if (state.view.name === 'detail') void renderDetail(state.view.issueId)
  else if (state.view.name === 'runDetail') void renderRunDetail(state.view.runId)
  else if (state.view.name === 'falsepositives') void renderArchive()
  else if (state.view.name === 'runs') void renderRuns()
  else renderBoard()
}

// --- Interactions -----------------------------------------------------------------------
// The same table the store enforces, restated for the drop target so an illegal drag is
// refused before a request is made — and refused with the same message the API would give.
// Copied from the prototype's canMove (output/secaudit-workbench.html:318): any move among the
// three board columns EXCEPT inbox -> done, which would put a finding in Done that no human
// ever confirmed.
const ALLOWED_DROPS = {
  inbox: { confirmed: 'confirm' },
  confirmed: { inbox: 'reopen', done: 'done' },
  done: { inbox: 'reopen', confirmed: 'confirm' },
}

let dragIssueId = null

function clearDrag() {
  dragIssueId = null
  for (const node of document.querySelectorAll('[data-drop]')) delete node.dataset.drop
  for (const node of document.querySelectorAll('.is-dragging')) node.classList.remove('is-dragging')
}

function wireDragAndDrop(cardNode, card, stage) {
  if (state.view.name !== 'board' || !ALLOWED_DROPS[stage]) return
  cardNode.draggable = true
  cardNode.addEventListener('dragstart', event => {
    dragIssueId = card.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', JSON.stringify({ id: card.id, from: stage }))
    cardNode.classList.add('is-dragging')
  })
  cardNode.addEventListener('dragend', clearDrag)
}

function readDrag(event) {
  try {
    return JSON.parse(event.dataTransfer.getData('text/plain'))
  } catch {
    return null
  }
}

function wireColumnDrop(laneNode, itemsNode, toStage) {
  if (state.view.name !== 'board') return
  laneNode.addEventListener('dragover', event => {
    if (!dragIssueId) return
    event.preventDefault()
    const from = findStage(dragIssueId)
    const action = ALLOWED_DROPS[from]?.[toStage]
    laneNode.dataset.drop = action ? 'allowed' : from === toStage ? 'same' : 'blocked'
    event.dataTransfer.dropEffect = action ? 'move' : 'none'
    if (from === 'inbox' && toStage === 'done') {
      toast('Nothing reaches Done without a human confirmation first.')
    }
    // Auto-scroll the lane while a card hovers near either edge, as the prototype does.
    const bounds = itemsNode.getBoundingClientRect()
    if (event.clientY < bounds.top + 45) itemsNode.scrollTop -= 18
    else if (event.clientY > bounds.bottom - 45) itemsNode.scrollTop += 18
  })
  laneNode.addEventListener('dragleave', event => {
    if (!laneNode.contains(event.relatedTarget)) delete laneNode.dataset.drop
  })
  laneNode.addEventListener('drop', event => {
    event.preventDefault()
    const payload = readDrag(event)
    clearDrag()
    if (!payload) return
    const action = ALLOWED_DROPS[payload.from]?.[toStage]
    if (!action) {
      toast('Nothing reaches Done without a human confirmation first.')
      return
    }
    void transition(payload.id, action)
  })
}

function findStage(issueId) {
  for (const [stage, cards] of Object.entries(state.board?.columns ?? {})) {
    if (cards.some(card => card.id === issueId)) return stage
  }
  return null
}

// The prototype's primary action per state, plus False positive everywhere but the archive.
// Every drag has this button equivalent: the buttons are ordinary focusable buttons in DOM
// order, so Enter and Space activate them with no extra key handling.
const ACTION_LABELS = {
  confirm: 'Confirm finding',
  done: 'Mark done',
  reopen: 'Reopen',
  'false-positive': 'False positive',
  restore: 'Restore to inbox',
}

function auditState(observation) {
  if (observation.challengeVerdict === 'NOT-A-DEFECT' || observation.traceVerdict === 'UNREACHABLE') {
    return 'Refuted'
  }
  if (observation.challengeVerdict === 'UNSURE') return 'Defect determination required'
  if (observation.traceVerdict === 'NEEDS-PROOF') return 'Runtime proof required'
  return 'Confirmed by audit'
}

async function renderDetail(issueId) {
  const data = await api('/api/issues/' + issueId)
  state.revision = data.revision
  const issue = data.issue
  const observation = issue.latestObservation
  const detail = el('article', 'detail')

  const header = el('div', 'detail-header')
  const meta = el('div', 'detail-meta')
  meta.append(el('span', 'mono', issue.id))
  if (issue.severity) {
    meta.append(el('span', 'severity' + (issue.severity === 'High' ? ' high' : ''), issue.severity))
  }
  // The audit verdict and the human state are different facts and must read as different facts.
  const workflow = issue.humanState === 'suppressed' && (issue.suppressedBy ?? 'human') === 'audit'
    ? 'Refuted by the audit'
    : (LABELS[issue.humanState] ?? issue.humanState)
  meta.append(el('span', '', 'Workflow: ' + workflow))
  header.append(meta, el('h1', 'detail-title', issue.title))

  const actions = el('div', 'detail-actions')
  const allowed = data.allowedActions
  allowed.forEach((action, index) => {
    actions.append(button(ACTION_LABELS[action] ?? action,
      'action' + (index === 0 ? ' primary' : ''), () => transition(issue.id, action)))
  })
  header.append(actions)

  const auditMeta = el('div', 'audit-meta')
  auditMeta.append(
    el('span', '', issue.class),
    el('span', '', 'Audit: ' + auditState(observation)),
    el('span', '', 'Last observed in run ' + issue.lastSeenRunId),
  )
  header.append(auditMeta)
  detail.append(header)

  // Section links, then the report itself. Report text goes into .report dd, whose
  // white-space: pre-wrap keeps the audit's own line breaks; nothing here is truncated.
  const nav = el('nav', 'section-nav')
  nav.setAttribute('aria-label', 'Report sections')
  const report = el('dl', 'report')
  data.sections.forEach((section, index) => {
    const row = el('div', 'report-row')
    row.id = 'report-section-' + index
    const link = el('a', '', section.label)
    link.href = '#' + row.id
    link.addEventListener('click', event => {
      event.preventDefault()
      row.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
    nav.append(link)
    row.append(el('dt', '', section.label), el('dd', '', section.text))
    report.append(row)
  })
  detail.append(nav, report)

  const history = el('details', 'history')
  history.append(el('summary', '', 'Workflow history (' + issue.events.length + ')'))
  const list = el('ol')
  for (const event of [...issue.events].reverse()) {
    const item = el('li', '', [event.actor, event.type, event.runId].filter(Boolean).join(' · '))
    if (event.utc) item.append(el('time', '', event.utc))
    list.append(item)
  }
  history.append(list)
  detail.append(history)

  q('#content').replaceChildren(detail)
}

async function renderRunDetail(runId) {
  const data = await api('/api/runs/' + encodeURIComponent(runId))
  const detail = el('section', 'detail')
  detail.append(el('h1', 'detail-title', runId))
  const facts = el('dl', 'run-facts')
  const rows = [
    ['Scope', data.facts.scope.length ? data.facts.scope.join(', ') : 'Whole target'],
    ['Checks run', data.facts.checksRun == null ? 'Not recorded' : String(data.facts.checksRun)],
    ['Observations', String(data.facts.observations)],
  ]
  for (const [label, value] of rows) {
    const cell = el('div')
    cell.append(el('dt', '', label), el('dd', '', value))
    facts.append(cell)
  }
  detail.append(facts, el('p', 'run-observations',
    'What this run observed, whatever a reviewer has since decided'))
  const list = el('div', 'register')
  for (const card of data.cards) list.append(issueCard(card, card.humanState))
  detail.append(list)
  q('#content').replaceChildren(detail)
}

q('#workspace-back').addEventListener('click', back)
q('#sidebar-toggle').addEventListener('click', () => setSidebarCollapsed(true))
q('#sidebar-expand').addEventListener('click', () => setSidebarCollapsed(false))
q('#search').addEventListener('input', event => {
  state.query = event.target.value.toLowerCase().trim()
  if (state.view.name === 'board') render()
})

await loadBoard()
render()

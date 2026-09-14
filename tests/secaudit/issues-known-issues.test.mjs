// tests/secaudit/issues-known-issues.test.mjs
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
// Windows: an absolute path is not a valid ESM specifier, so dynamic import takes a URL.
const script = name => import(pathToFileURL(join(scripts, name)).href)
const { emptyStore, ingestRun, applyTransition, writeStore } =
  await script('issue-store.mjs')
const { suppressedIndex, writeKnownIssuesDigest, markSuppressed } =
  await script('known-issues.mjs')

const SUPPRESSED_FP = 'fp1:' + '1'.repeat(24)
const LIVE_FP = 'fp1:' + '2'.repeat(24)

const observation = (over = {}) => ({
  observationId: 'o1', runId: 'r1', class: 'sqli', path: 'a.py', line: 4,
  title: 'SQL injection', severity: 'High', challengeVerdict: 'DEFECT',
  challengeReason: 'concat', traceVerdict: 'REACHABLE', traceEvidence: 'route',
  impact: 'i', remediation: 'r', dynamicTest: null,
  fingerprint: SUPPRESSED_FP, fingerprintKind: 'anchor', ...over,
})

let store = ingestRun(emptyStore(), {
  runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
  status: 'ok',
  observations: [observation(), observation({
    observationId: 'o2', path: 'b.py', fingerprint: LIVE_FP,
  })],
}).store

const suppressedId = store.issues.find(i => i.path === 'a.py').id
store = applyTransition(store, { issueId: suppressedId, action: 'false-positive',
  revision: store.revision, utc: '2026-01-02T00:00:00Z' }).store

const project = mkdtempSync(join(tmpdir(), 'secaudit known-'))
await writeStore(project, store)

// The index carries every fingerprint of every suppressed issue, and nothing else.
const index = await suppressedIndex(project)
assert.ok(index.has(SUPPRESSED_FP))
assert.ok(!index.has(LIVE_FP))
assert.equal(index.get(SUPPRESSED_FP).issueId, suppressedId)

// The digest is written for the Challenge stage, and names the suppressed finding.
const work = mkdtempSync(join(tmpdir(), 'secaudit known-work-'))
mkdirSync(join(work, 'sast'), { recursive: true })
const digest = await writeKnownIssuesDigest(project, work)
assert.equal(digest.count, 1)
const digestText = readFileSync(digest.path, 'utf8')
assert.ok(digestText.includes('a.py'))
assert.ok(!digestText.includes('b.py'), 'only suppressed issues belong in the digest')

// An empty archive still writes a file: a missing digest must always mean a bug.
const cleanProject = mkdtempSync(join(tmpdir(), 'secaudit known-clean-'))
const cleanWork = mkdtempSync(join(tmpdir(), 'secaudit known-clean-work-'))
mkdirSync(join(cleanWork, 'sast'), { recursive: true })
const emptyDigest = await writeKnownIssuesDigest(cleanProject, cleanWork)
assert.equal(emptyDigest.count, 0)
assert.ok(readFileSync(emptyDigest.path, 'utf8').length > 0)

// Marking is deterministic and leaves the audit's own verdict untouched.
const marked = markSuppressed({
  findings: [
    { class: 'sqli', path: 'a.py', line: 4, challengeVerdict: 'DEFECT',
      anchor: { fingerprint: SUPPRESSED_FP } },
    { class: 'sqli', path: 'b.py', line: 9, challengeVerdict: 'DEFECT',
      anchor: { fingerprint: LIVE_FP } },
    { class: 'idor', path: 'c.py', line: 1, challengeVerdict: 'DEFECT', anchor: null },
  ],
}, index)
assert.equal(marked.findings[0].suppressed, true)
assert.equal(marked.findings[0].suppressedIssueId, suppressedId)
assert.equal(marked.findings[0].challengeVerdict, 'DEFECT', 'the audit verdict is not rewritten')
assert.equal(marked.findings[1].suppressed, false)
// An unanchored finding cannot be matched, so it is never claimed as suppressed.
assert.equal(marked.findings[2].suppressed, false)

console.log('issues-known-issues: ok')

// Publication-time suppression is a HUMAN guarantee. An audit refutation is already reported
// as refuted; claiming it dismissed would move it out of the refuted count and imply a review
// that never happened.
{
  const { emptyStore: empty, ingestRun: ingest, writeStore: write } =
    await script('issue-store.mjs')
  const root = mkdtempSync(join(tmpdir(), 'secaudit refuted-'))
  const store = ingest(empty(), {
    runId: 'r1', runDir: '/x/r1', createdUtc: '2026-01-01T00:00:00Z', target: '/p', scope: [],
    status: 'ok',
    observations: [{
      observationId: 'o1', runId: 'r1', class: 'idor', path: 'b.py', line: 2,
      title: 'Archive lookup exposure', severity: null, challengeVerdict: 'DEFECT',
      challengeReason: 'reachable only from a removed route', traceVerdict: 'UNREACHABLE',
      traceEvidence: 'no route reaches it', impact: null, remediation: null, dynamicTest: null,
      fingerprint: 'fp1:' + '2'.repeat(24), fingerprintKind: 'anchor', bucket: 'refuted',
    }],
  }).store
  assert.equal(store.issues[0].humanState, 'suppressed')
  await write(root, store)
  assert.equal((await suppressedIndex(root)).size, 0)
  console.log('issues-known-issues audit refutation: ok')
}

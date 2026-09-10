// plugins/secaudit/skills/issues/scripts/known-issues.mjs
// What a human already dismissed. Two consumers, and they are not equally trustworthy:
// publish-artifacts matches fingerprints deterministically (the guarantee), while the Challenge
// stage reads a digest as advice (a courtesy, so it stops re-arguing a closed case). Never rely
// on the digest for the guarantee — a prompt is not an access control.
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readStore } from './issue-store.mjs'

export async function suppressedIndex(projectRoot) {
  const store = await readStore(projectRoot)
  const index = new Map()
  for (const issue of store.issues) {
    if (issue.humanState !== 'suppressed') continue
    for (const fingerprint of issue.fingerprints) {
      index.set(fingerprint, {
        issueId: issue.id,
        class: issue.class,
        path: issue.path,
        title: issue.title,
        suppressedUtc: issue.lastHumanUtc,
      })
    }
  }
  return index
}

const HEADER = [
  '# Known false positives',
  '',
  'A human reviewed each finding below in an earlier audit and dismissed it. Do not spend',
  'effort re-arguing them. Report what you find as normal — a deterministic fingerprint match',
  'at publication time groups these out of the actionable results, so nothing here depends on',
  'your judgement. This file is advice, not a filter, and it is not evidence about the code.',
  '',
]

export async function writeKnownIssuesDigest(projectRoot, work) {
  const index = await suppressedIndex(projectRoot)
  const entries = [...index.values()]
    .filter((value, i, all) => all.findIndex(v => v.issueId === value.issueId) === i)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const lines = entries.length === 0
    ? ['_No findings have been dismissed in this project._', '']
    : [...entries.map(e => '- `' + e.class + '` ' + e.path + ' — ' + e.title
        + ' (dismissed ' + (e.suppressedUtc ?? 'date not recorded') + ', issue ' + e.issueId + ')'), '']
  const dir = join(work, 'sast')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'known-issues.md')
  await writeFile(path, [...HEADER, ...lines].join('\n'), 'utf8')
  return { path, count: entries.length }
}

// Pure. A finding with no anchor has no comparable identity, so it is never claimed as
// suppressed — an unanchored guess is exactly the false silence this feature must avoid.
export function markSuppressed(reportData, index) {
  return {
    ...reportData,
    findings: reportData.findings.map(finding => {
      const hit = finding.anchor?.fingerprint ? index.get(finding.anchor.fingerprint) : undefined
      return {
        ...finding,
        suppressed: Boolean(hit),
        suppressedIssueId: hit?.issueId ?? null,
      }
    }),
  }
}

import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')
const HUNTERS = ['businesslogic','fileupload','graphql','hardcodedsecrets','idor','jwt','missingauth','pathtraversal','rce','sqli','ssrf','ssti','xss','xxe']

// Bracketed hunt-verdict tags that must NOT survive in any Hunter SKILL.md.
const FORBIDDEN = [
  '[VULNERABLE]','[LIKELY VULNERABLE]','[NEEDS MANUAL REVIEW]','[NOT VULNERABLE]',
  '[EXPLOITABLE]','[LIKELY EXPLOITABLE]','[NOT EXPLOITABLE]',
]

for (const d of HUNTERS) {
  const p = join(root, `skills/sast-hunter-${d}/SKILL.md`)
  const src = readFileSync(p, 'utf8')
  for (const tag of FORBIDDEN) {
    assert.ok(!src.includes(tag), `sast-hunter-${d}/SKILL.md still contains forbidden tag ${tag}`)
  }
  assert.ok(src.includes('[FINDING]'), `sast-hunter-${d}/SKILL.md missing [FINDING] tag`)
  assert.match(src, /\*\*Confidence:\*\*\s*high\|medium\|low/, `sast-hunter-${d}/SKILL.md missing mandatory Confidence line`)
  assert.match(src, /##\s*Round 1/, `sast-hunter-${d}/SKILL.md missing ## Round 1 section`)
  assert.match(src, /re-hunt[\s\S]{0,200}## Round/i, `sast-hunter-${d}/SKILL.md missing append-a-new-Round-section instruction`)
  // Hunt handoff: results feed Challenge (adversarial re-check), not the retired Validate stage.
  assert.match(src, /Downstream Challenge[\s\S]{0,80}Trace/, `sast-hunter-${d}/SKILL.md missing Downstream Challenge/Trace handoff`)
  assert.ok(!/\bDownstream Validate\b/.test(src), `sast-hunter-${d}/SKILL.md still hands off to retired Validate stage`)
}

for (const d of HUNTERS) {
  const p = join(root, `skills/sast-hunter-${d}/references/examples.md`)
  const src = readFileSync(p, 'utf8')
  for (const tag of FORBIDDEN) {
    assert.ok(!src.includes(tag), `sast-hunter-${d}/references/examples.md still contains forbidden tag ${tag}`)
  }
  // Every finding-format example heading uses [FINDING] with a location in parens.
  assert.match(src, /###\s*\[FINDING\][^\n]*\([^)]+:[0-9]+\)/, `sast-hunter-${d}/examples.md missing a '### [FINDING] ... (file:line)' example`)
  assert.match(src, /\*\*Confidence:\*\*/, `sast-hunter-${d}/examples.md missing a **Confidence:** example line`)
  assert.match(src, /Challenge\/Trace/, `sast-hunter-${d}/examples.md missing Challenge/Trace handoff`)
}

// 24. Contradictory LEGACY classification prose must not survive in either file: no imperative
//     "flag as <bucket>" / "mark as <bucket>" / "classify as <bucket>" directive naming an old
//     four-bucket verdict, and no old "**Classification**" rubric header. Case-insensitive.
//     EXEMPTION: the new SKILL.md reminder line legitimately says
//     "Do NOT classify as vulnerable/not-vulnerable; report candidates" — that lowercase,
//     hyphenated compound is the NEW contract, not a legacy bucket name, and must NOT be flagged.
function legacyClassificationHits(text) {
  const hits = []
  if (/\*\*Classification\*\*/i.test(text)) hits.push('**Classification** rubric header')
  const flagOrMarkRe = /\b(?:flag|mark)\s+(?:it\s+|this\s+|them\s+|these\s+)?as\s+\**\s*(?:not\s+)?(?:likely\s+)?(vulnerable|exploitable)\b/gi
  for (const m of text.matchAll(flagOrMarkRe)) hits.push(m[0])
  const classifyRe = /\bclassify\s+(?:it\s+|this\s+|them\s+)?as\s+["'‘“]?([^".\n]+?)["'’”]?[.,;]/gi
  for (const m of text.matchAll(classifyRe)) {
    const bucket = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
    // legitimate new-contract reminder (businesslogic uses the exploitable/not-exploitable family)
    if (bucket === 'vulnerable/not-vulnerable' || bucket === 'exploitable/not-exploitable') continue
    hits.push(m[0])
  }
  return hits
}

for (const d of HUNTERS) {
  const skillSrc = readFileSync(join(root, `skills/sast-hunter-${d}/SKILL.md`), 'utf8')
  const exSrc = readFileSync(join(root, `skills/sast-hunter-${d}/references/examples.md`), 'utf8')
  assert.deepStrictEqual(legacyClassificationHits(skillSrc), [], `sast-hunter-${d}/SKILL.md still has legacy classification prose`)
  assert.deepStrictEqual(legacyClassificationHits(exSrc), [], `sast-hunter-${d}/examples.md still has legacy classification prose`)
}

// Confirm the exemption itself does not false-positive (the exact legitimate line from SKILL.md).
assert.deepStrictEqual(
  legacyClassificationHits('Do NOT classify as vulnerable/not-vulnerable; report candidates with evidence.'),
  [],
  'legacy-prose check must not flag the legitimate "Do NOT classify as vulnerable/not-vulnerable" reminder',
)

console.log('PASS hunt-vocabulary: detector SKILL.md + examples.md contracts')

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'secaudit')

// Live pipeline surfaces only. Historical specs (docs/superpowers), the .agents
// mirrors (symlinks of .claude — scanning both would double-report), and eval run
// outputs are intentionally excluded.
const ROOTS = ['README.md', 'workflows', 'skills']
const SCAN_EXT = new Set(['.md', '.js', '.mjs', '.json'])

const RETIRED = [
  /\bdetectors?\b/i,
  /secaudit-validate|\*\*Validate:\*\*|phase\('Validate'/i,
  /\bvalidators?\b/i,
  /secaudit-gapfill|gapfill-tasks|\bGapfill\b/i,
  /secaudit-feedback|feedback-tasks|phase\('Feedback'/i,
  /phase\('(Setup|Report|Harvest)'/i,
]

function collectFiles(relPath, isRoot = false) {
  const abs = join(root, relPath)
  let st
  try {
    st = statSync(abs)
  } catch {
    if (isRoot) throw new Error(`live-pipeline-vocabulary: scan root missing: ${relPath}`)
    return []
  }
  if (st.isFile()) {
    return SCAN_EXT.has(extname(abs)) ? [abs] : []
  }
  const out = []
  for (const entry of readdirSync(abs)) {
    out.push(...collectFiles(join(relPath, entry)))
  }
  return out
}

// Two narrow, deliberate exemptions — not pipeline vocabulary describing the
// current system, so migrating them would break tested, permanent behavior
// or mangle third-party example code:
//
// 1. workflows/secaudit.js's input-rejection shim intentionally quotes
//    the OLD config keys ('detectors'/'loops'/'validateBatch') to explain what
//    replaced them when a caller still passes them. tests/hunter-config.test.mjs
//    asserts this exact rejection text; it is a permanent compatibility guard,
//    not stale prose.
// 2. sast-hunter-fileupload/references/examples.md's Django snippet uses Django's own
//    `validators=[...]` kwarg / `validate_file_extension` name — that is
//    third-party framework vocabulary in an example, not the secaudit
//    pipeline's retired Validator role.
const EXEMPT_LINE_MARKERS = {
  'workflows/secaudit.js': [
    "'detectors', 'loops', 'validateBatch'",
    "detectors: 'hunters',",
    'detectors → hunters',
  ],
  'skills/sast-hunter-fileupload/references/examples.md': [
    'custom validator on FileField',
    'validators=[validate_file_extension]',
  ],
}

function isExempt(relFile, text) {
  const markers = EXEMPT_LINE_MARKERS[relFile]
  return markers ? markers.some((m) => text.includes(m)) : false
}

const files = ROOTS.flatMap((r) => collectFiles(r, true))
const hits = []

for (const file of files) {
  // Normalize to POSIX separators: EXEMPT_LINE_MARKERS is keyed with '/', and on Windows
  // join() yields '\', so an unnormalized key never matches and exempt lines get flagged.
  const relFile = file.slice(root.length + 1).split('\\').join('/')
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, idx) => {
    if (isExempt(relFile, line)) return
    for (const re of RETIRED) {
      if (re.test(line)) {
        hits.push({ file: relFile, line: idx + 1, term: re.source, text: line.trim() })
      }
    }
  })
}

if (hits.length > 0) {
  const report = hits.map((h) => `${h.file}:${h.line}: matched /${h.term}/ — ${h.text}`).join('\n')
  throw new Error(`live-pipeline-vocabulary: retired pipeline vocabulary found in live surfaces:\n${report}`)
}

console.log(`PASS live-pipeline-vocabulary: ${files.length} files scanned, no retired terms`)

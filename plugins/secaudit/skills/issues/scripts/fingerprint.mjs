// plugins/secaudit/skills/issues/scripts/fingerprint.mjs
// Cross-run identity. Deliberately excludes the finding's TITLE (a model rewords it every run)
// and its ABSOLUTE LINE (an import block above it shifts it). What remains is the class, the
// normalized path, the nearest enclosing declaration, and a hash of the offending line's text —
// stable under edits elsewhere, distinct for two defects inside one function.
import { createHash } from 'node:crypto'
import { extname } from 'node:path'

export const FINGERPRINT_VERSION = 1

const JS_PATTERNS = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/,
]
const CLASSLIKE = /^\s*(?:public|private|protected|internal|abstract|sealed|static|final|open|data|\s)*(?:class|interface|record|object|enum)\s+([A-Za-z_]\w*)/
// A call statement (`return Sql(id);`, `if (x) foo(y)`) has the same shape as a method
// signature, so the leading token must not be a control keyword — otherwise every call site
// reads as its own declaration and the anchor stops being the enclosing method.
const CONTROL_KEYWORDS = /^(?:return|if|else|for|foreach|while|do|switch|case|catch|throw|new|using|lock|await|yield|assert|when)$/
const METHODLIKE = /^\s*(?:@\w+\s*)*(?:public|private|protected|internal|static|final|override|suspend|abstract|virtual|async|fun|\s)*([\w<>[\],.?]+)\s+([A-Za-z_]\w*)\s*\(/

const DECL_PATTERNS = new Map([
  ['.py', [/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/]],
  ['.js', JS_PATTERNS],
  ['.ts', JS_PATTERNS],
  ['.go', [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/]],
  ['.java', [METHODLIKE, CLASSLIKE]],
  ['.kt', [METHODLIKE, CLASSLIKE]],
  ['.cs', [METHODLIKE, CLASSLIKE]],
])

// Collapse formatting noise so a reindent or a space around an operator does not read as a new
// defect — but leave string literals byte-for-byte. Whitespace inside a literal is part of the
// value (a SQL fragment, a path, a regex), and two literals differing only there are two
// different defects.
export function normalizeCodeLine(text) {
  const src = String(text)
  let out = ''
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      out += ch
      if (ch === '\\' && i + 1 < src.length) out += src[++i]
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }
    if (/\s/.test(ch)) {
      if (!out.endsWith(' ')) out += ' '
      continue
    }
    out += ch
  }
  return out.trim()
}

export function enclosingDeclaration(lines, lineNumber, ext) {
  const patterns = DECL_PATTERNS.get(ext)
  if (!patterns) return null
  for (let i = Math.min(lineNumber, lines.length) - 1; i >= 0; i--) {
    for (const pattern of patterns) {
      const match = pattern.exec(lines[i])
      if (!match) continue
      if (pattern === METHODLIKE) {
        if (CONTROL_KEYWORDS.test(match[1])) continue
        return { kind: 'decl', name: match[2] }
      }
      const name = match.slice(1).find(Boolean)
      if (name) return { kind: 'decl', name }
    }
  }
  return null
}

export function computeAnchor({ sourceText, line, path }) {
  const lines = String(sourceText).split(/\r?\n/)
  const ext = extname(path).toLowerCase()
  const decl = enclosingDeclaration(lines, line, ext)
  const raw = lines[Math.min(Math.max(line, 1), lines.length) - 1] ?? ''
  return {
    anchorKind: decl ? 'decl' : 'file',
    anchorName: decl ? decl.name : path,
    codeHash: createHash('sha256').update(normalizeCodeLine(raw), 'utf8').digest('hex').slice(0, 16),
  }
}

function digest(parts) {
  return createHash('sha256').update(parts.join(' '), 'utf8').digest('hex').slice(0, 24)
}

export function fingerprintFor({ class: cls, path, anchorKind, anchorName, codeHash }) {
  return 'fp1:' + digest(['v1', cls, path, anchorKind, anchorName, codeHash])
}

// No source text was available (a pruned historical run), so there is no anchor and the line
// number has to stand in for one. A legacy fingerprint therefore does NOT survive line shifts,
// and matching never auto-merges one with an anchored fingerprint — it asks a human instead.
export function legacyFingerprintFor({ class: cls, path, line }) {
  return 'legacy1:' + digest(['legacy1', cls, path, String(line)])
}

// Extracted from security-scanning scripts/preflight.mjs — the one predicate the content
// tests share. Codex honours allow_implicit_invocation only as a direct child of the
// top-level `policy:` key; no YAML parser here (zero dependencies), slice by indentation.
const yamlBlock = (text, key) => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^${key}:\\s*$`).test(line))
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n')
}
const indentOf = line => /^[ \t]*/.exec(line)[0].length

export const hasExplicitOnlyPolicy = text => {
  const block = yamlBlock(text, 'policy')
  if (block === null) return false
  const lines = block.split('\n').filter(l => l.trim() !== '' && !/^[ \t]*#/.test(l))
  if (lines.length === 0) return false
  const childIndent = Math.min(...lines.map(indentOf))
  return lines.some(l =>
    indentOf(l) === childIndent && /^[ \t]*allow_implicit_invocation:[ \t]*false[ \t]*$/.test(l))
}

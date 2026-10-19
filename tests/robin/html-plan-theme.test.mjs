import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'robin', 'skills', 'html-plan', 'runtime', 'htmlplan.css'), 'utf8')

// `pack.mjs --artifact` strips the page's own <html> and <body>; the Artifact host wraps the page in
// its own, and that body can be white. Painting only <html> left dark-mode text on a white page, so
// the body has to carry the page colours itself.
const body = css.match(/^body\s*\{([^}]*)\}/m)
assert.ok(body, 'htmlplan.css has a top-level body rule')
assert.match(body[1], /background:\s*var\(--paper\)/, 'body paints the page background')
assert.match(body[1], /(^|;)\s*color:\s*var\(--ink\)/, 'body sets the page text colour')

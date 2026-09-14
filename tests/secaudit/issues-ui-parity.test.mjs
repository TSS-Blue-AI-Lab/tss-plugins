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

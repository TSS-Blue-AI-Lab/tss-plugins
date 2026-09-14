// tests/secaudit/issues-server.test.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
const { startServer } = await import(join(scripts, 'server.mjs'))

const projectRoot = mkdtempSync(join(tmpdir(), 'secaudit server-'))
const server = await startServer({ projectRoot, port: 0 })

try {
  // Loopback only.
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/)

  const page = await fetch(server.url + '/')
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')

  // The API answers.
  const board = await (await fetch(server.url + '/api/board')).json()
  assert.equal(board.ok, true)

  // Path traversal out of the UI directory is refused, and refused visibly.
  const escaped = await fetch(server.url + '/../scripts/server.mjs')
  assert.ok([403, 404].includes(escaped.status))
  const encoded = await fetch(server.url + '/%2e%2e/scripts/server.mjs')
  assert.ok([403, 404].includes(encoded.status))
  assert.ok(!(await encoded.text()).includes('startServer'))

  // A cross-origin write is refused.
  const foreign = await fetch(server.url + '/api/issues/iss_x/transition', {
    method: 'POST',
    headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'confirm', revision: 0 }),
  })
  assert.equal(foreign.status, 403)
} finally {
  await server.close()
}

console.log('issues-server: ok')

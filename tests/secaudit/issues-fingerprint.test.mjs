// tests/secaudit/issues-fingerprint.test.mjs
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert'

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', '..',
  'plugins', 'secaudit', 'skills', 'issues', 'scripts')
// Windows: an absolute path is not a valid ESM specifier, so dynamic import takes a URL.
const script = name => import(pathToFileURL(join(scripts, name)).href)
const { computeAnchor, fingerprintFor, legacyFingerprintFor, normalizeCodeLine } =
  await script('fingerprint.mjs')

const before = [
  'import os',
  '',
  'def get_order(order_id):',
  '    return db.query("SELECT * FROM orders WHERE id = " + order_id)',
  '',
  'def list_orders(user):',
  '    return db.query("SELECT * FROM orders WHERE user = " + user)',
].join('\n')

// The same defect after unrelated edits above it and a reformat of the offending line.
const after = [
  'import os',
  'import sys',
  'import json',
  '',
  '',
  'def get_order(order_id):',
  '    return db.query("SELECT * FROM orders WHERE id = "  +  order_id)',
  '',
  'def list_orders(user):',
  '    return db.query("SELECT * FROM orders WHERE user = " + user)',
].join('\n')

const fp = f => fingerprintFor({ class: 'sqli', path: 'app/orders.py', ...f })

const a = computeAnchor({ sourceText: before, line: 4, path: 'app/orders.py' })
const b = computeAnchor({ sourceText: after, line: 7, path: 'app/orders.py' })
assert.equal(a.anchorKind, 'decl')
assert.equal(a.anchorName, 'get_order')
assert.equal(fp(a), fp(b), 'a line shift plus whitespace reformat must not change identity')

// Two independent defects of the same class in one file stay distinct.
const other = computeAnchor({ sourceText: after, line: 10, path: 'app/orders.py' })
assert.notEqual(fp(a), fp(other))

// Files with no declaration grammar anchor to the file plus the line's text.
const html = computeAnchor({
  sourceText: '<div>{{ user_input }}</div>\n', line: 1, path: 'templates/x.html',
})
assert.equal(html.anchorKind, 'file')
assert.equal(html.anchorName, 'templates/x.html')

// Normalization collapses whitespace but preserves literals.
assert.equal(normalizeCodeLine('   a  =  "b  c"  '), 'a = "b  c"')

// Legacy fingerprints are a distinct namespace and can never collide with anchored ones.
const legacy = legacyFingerprintFor({ class: 'sqli', path: 'app/orders.py', line: 4 })
assert.ok(legacy.startsWith('legacy1:'))
assert.ok(fp(a).startsWith('fp1:'))
assert.notEqual(legacy, fp(a))

// Go, JS, and C# declarations resolve.
assert.equal(computeAnchor({
  sourceText: 'package main\n\nfunc (s *Server) Handle(w http.ResponseWriter) {\n\texec(cmd)\n}\n',
  line: 4, path: 'srv/main.go',
}).anchorName, 'Handle')
assert.equal(computeAnchor({
  sourceText: 'export async function login(req) {\n  db.raw(req.body.q)\n}\n',
  line: 2, path: 'src/login.js',
}).anchorName, 'login')
assert.equal(computeAnchor({
  sourceText: 'public class Orders {\n  public Order Get(int id) {\n    return Sql(id);\n  }\n}\n',
  line: 3, path: 'src/Orders.cs',
}).anchorName, 'Get')

console.log('issues-fingerprint: ok')

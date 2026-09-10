// plugins/secaudit/skills/issues/scripts/server.mjs
// A local triage board, not a service. It binds to loopback, serves one fixed asset directory,
// and speaks to exactly one project's store. Nothing here is designed to be exposed.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname, extname, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { handleRequest } from './http-routes.mjs'

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui')

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; "
  + "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
])

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// Decode first, then normalize, then prove the result is still inside UI_DIR. Checking for '..'
// in the raw URL misses '%2e%2e', and checking after join misses nothing — so check after join.
function resolveAsset(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const rel = normalize(decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''))
  const abs = join(UI_DIR, rel)
  return abs === UI_DIR || abs.startsWith(UI_DIR + sep) ? abs : null
}

export async function startServer({ projectRoot, port = 0 }) {
  const server = createServer((req, res) => {
    void (async () => {
      const origin = 'http://127.0.0.1:' + server.address().port
      const path = (req.url ?? '/').split('?')[0]

      if (path.startsWith('/api/')) {
        const result = await handleRequest({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: req.method === 'POST' ? await readBody(req) : undefined,
          projectRoot,
          origin,
          now: new Date().toISOString(),
        })
        res.writeHead(result.status, { ...SECURITY_HEADERS, ...result.headers })
        res.end(result.body)
        return
      }

      const asset = resolveAsset(path)
      if (!asset) {
        res.writeHead(403, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
        res.end('refused: that path is outside the dashboard asset directory')
        return
      }
      const content = await readFile(asset).catch(() => null)
      if (content == null) {
        res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': TYPES.get(extname(asset).toLowerCase()) ?? 'application/octet-stream',
      })
      res.end(content)
    })().catch(err => {
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      res.end('internal error: ' + err.message)
    })
  })

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  const bound = server.address().port
  return {
    url: 'http://127.0.0.1:' + bound,
    port: bound,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function parseArgs(argv) {
  const options = { port: 0 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') options.project = argv[++i]
    else if (argv[i] === '--port') options.port = Number(argv[++i])
    else throw new Error('server: unknown argument ' + argv[i])
  }
  if (!options.project) throw new Error('server: --project <path> is required')
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { project, port } = parseArgs(process.argv.slice(2))
  startServer({ projectRoot: project, port })
    .then(({ url }) => console.log(JSON.stringify({ url })))
    .catch(err => {
      console.error(err.message)
      process.exitCode = 1
    })
}

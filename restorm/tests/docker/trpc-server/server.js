/**
 * tRPC mock server for the restorm tRPC execution + import E2E suite.
 *
 * Hand-rolled (NOT `@trpc/server`) — the goal is to exercise the v10
 * non-batch wire format Restorm speaks, not to stand up a real tRPC
 * router. Mirrors the `http-util` / `odata-v2-petstore` precedent — a
 * tiny, dependency-free `node:http` server so CI can boot it with a bare
 * `node server.js` (no `npm install`).
 *
 * Wire format (tRPC v10, non-batch):
 *   - query:    GET  /<procedure>?input=<urlEncoded JSON>
 *   - mutation: POST /<procedure>  body: {"0":{"json":<input>}}
 *   - success:  [{ "result": { "data": <output> } }]
 *   - error:    [{ "error": { "json": { "message", "code", "httpStatus" } } }]
 *     (HTTP status mirrors the error's `httpStatus`, matching a real
 *     tRPC server's behaviour — restorm's importer/execution never
 *     assumes 200 on a wire-level error.)
 *
 * Routes:
 *   GET  /health                 → 200 "ok" (readiness probe).
 *   GET  /user.get?input=...     → query; returns `{ id, name }` for the
 *                                   requested `id` (404 tRPC error if unknown).
 *   POST /post.create            → mutation; echoes `{ id, title }` for a
 *                                   freshly created post (auto id).
 *   GET  /echo.header?input=...  → query; `input.name` names an HTTP header,
 *                                   returns `{ value }` read off the actual
 *                                   request — proves a Handlebars-resolved
 *                                   header value reached the wire (not the
 *                                   literal `{{var}}`).
 *   POST /slow.echo              → mutation; waits `input.delayMs` then
 *                                   returns `{ echoed: input.message }` — for
 *                                   the cancellation scenario (still in-flight
 *                                   when the test clicks Cancel).
 *   *    /error.fail             → always throws a tRPC error (BAD_REQUEST,
 *                                   HTTP 400) — exercises the error path.
 *   GET  /.trpc/_schema          → best-effort router introspection JSON
 *                                   (restorm-specific minimal shape — real
 *                                   tRPC servers don't standardise this;
 *                                   the importer treats it as opportunistic).
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 8096

const USERS = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' }
]

let nextPostId = 1

// tRPC error codes → HTTP status, mirroring the real server's mapping.
const TRPC_ERROR_HTTP_STATUS = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** Non-batch success envelope: `[{ result: { data } }]`. */
function sendResult(res, data) {
  sendJson(res, 200, [{ result: { data } }])
}

/** Non-batch error envelope: `[{ error: { json: { message, code } } }]`. */
function sendError(res, code, message) {
  const httpStatus = TRPC_ERROR_HTTP_STATUS[code] ?? 500
  sendJson(res, httpStatus, [{ error: { json: { message, code, httpStatus } } }])
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

/** Parse the v10 non-batch POST envelope `{"0":{"json":<input>}}` into
 * `<input>` (or `undefined` for a no-input call / an unparsable body). */
function parseMutationInput(raw) {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed?.['0']?.json
  } catch {
    return undefined
  }
}

const SCHEMA = {
  procedures: {
    'user.get': { kind: 'query', input: { id: 'number' }, output: { id: 'number', name: 'string' } },
    'post.create': { kind: 'mutation', input: { title: 'string' }, output: { id: 'number', title: 'string' } },
    'echo.header': { kind: 'query', input: { name: 'string' }, output: { value: 'string' } },
    'slow.echo': { kind: 'mutation', input: { delayMs: 'number', message: 'string' }, output: { echoed: 'string' } },
    'error.fail': { kind: 'mutation', input: {}, output: {} }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = parsed.pathname

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  if (pathname === '/.trpc/_schema') {
    sendJson(res, 200, SCHEMA)
    return
  }

  if (pathname === '/user.get') {
    let input
    try {
      const rawInput = parsed.searchParams.get('input')
      input = rawInput !== null ? JSON.parse(rawInput) : undefined
    } catch {
      sendError(res, 'BAD_REQUEST', 'Malformed input')
      return
    }
    const user = USERS.find((u) => u.id === input?.id)
    if (!user) {
      sendError(res, 'NOT_FOUND', `No user with id ${input?.id}`)
      return
    }
    sendResult(res, user)
    return
  }

  if (pathname === '/post.create' && req.method === 'POST') {
    const raw = await readBody(req)
    const input = parseMutationInput(raw)
    const title = typeof input?.title === 'string' ? input.title : ''
    const post = { id: nextPostId, title }
    nextPostId += 1
    sendResult(res, post)
    return
  }

  if (pathname === '/echo.header') {
    let input
    try {
      const rawInput = parsed.searchParams.get('input')
      input = rawInput !== null ? JSON.parse(rawInput) : undefined
    } catch {
      sendError(res, 'BAD_REQUEST', 'Malformed input')
      return
    }
    const headerName = typeof input?.name === 'string' ? input.name.toLowerCase() : ''
    // Node lower-cases incoming header names.
    const value = req.headers[headerName] ?? null
    sendResult(res, { value })
    return
  }

  if (pathname === '/slow.echo' && req.method === 'POST') {
    const raw = await readBody(req)
    const input = parseMutationInput(raw)
    const delayMs = typeof input?.delayMs === 'number' ? input.delayMs : 0
    const message = typeof input?.message === 'string' ? input.message : ''
    await sleep(delayMs)
    sendResult(res, { echoed: message })
    return
  }

  if (pathname === '/error.fail') {
    // Drain the body so a mutation call doesn't leave the socket hanging.
    if (req.method === 'POST') await readBody(req)
    sendError(res, 'BAD_REQUEST', 'error.fail always fails')
    return
  }

  sendError(res, 'NOT_FOUND', `No procedure matches ${pathname}`)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tRPC mock server ready at http://0.0.0.0:${PORT}`)
})

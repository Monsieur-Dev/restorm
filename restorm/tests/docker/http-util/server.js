/**
 * HTTP utility mock server for the restorm HTTP/REST execution E2E suite.
 *
 * The Docker Petstore covers CRUD / methods / JSON / multipart upload /
 * 400s, but it cannot deterministically produce redirects, settable
 * cookies, arbitrary status codes, or a request echo. This tiny
 * zero-dependency Node server fills those gaps so the execution matrix
 * can assert wire-level behaviour (Handlebars substitution, auth
 * injection, redirect following + toggle, cookie store-and-resend,
 * binary preservation, raw-body round-trips).
 *
 * Mirrors the `graphql-server` precedent (a self-hosted mock under
 * tests/docker) but stays dependency-free — pure `node:http`, no
 * `npm install` step, so it boots the instant the container starts.
 *
 * Routes:
 *   GET|POST|… /echo          → JSON echo of method, path, query,
 *                               headers, and the raw request body.
 *   GET        /redirect/:n   → 302 → /redirect/:n-1 → … → /echo
 *                               (chain of `n` redirects; `?status=NNN`
 *                               overrides the redirect status code).
 *   GET        /status/:code  → responds with the given HTTP status,
 *                               a JSON body, and a deterministic header.
 *   GET        /cookie/set    → Set-Cookie: session=<value>; resp body
 *                               states what it set (?name=&value=).
 *   GET        /cookie/echo   → JSON echo of the received Cookie header
 *                               (proves the jar stored + re-sent it).
 *   GET        /binary        → a deterministic binary payload
 *                               (image/png magic bytes) for the
 *                               binary-response-preservation case.
 *   GET        /xml           → an application/xml document.
 *   GET        /html          → a text/html document.
 *   GET        /multi-header  → two `X-Multi` response headers (a
 *                               genuine multi-value header).
 *   GET        /slow          → responds after `?ms=` milliseconds
 *                               (cancellation + timeout cases).
 *   GET        /health        → 200 "ok" (readiness probe).
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 8082

/** Read the full request body into a Buffer. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.concat(chunks)))
  })
}

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(status, { 'Content-Type': 'application/json', ...(extraHeaders || {}) })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  const query = Object.fromEntries(url.searchParams.entries())

  // GET /health — readiness probe.
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  // /echo — reflect the request so the test can assert what reached the wire.
  if (path === '/echo') {
    const bodyBuf = await readBody(req)
    sendJson(res, 200, {
      method: req.method,
      path,
      query,
      headers: req.headers,
      body: bodyBuf.toString('utf-8'),
      bodyBase64: bodyBuf.toString('base64')
    })
    return
  }

  // /redirect/:n — chain of n redirects, terminating at /echo.
  const redirectMatch = path.match(/^\/redirect\/(\d+)$/)
  if (redirectMatch) {
    const n = Number(redirectMatch[1])
    const status = query.status ? Number(query.status) : 302
    const next = n <= 1 ? '/echo' : `/redirect/${n - 1}${query.status ? `?status=${query.status}` : ''}`
    res.writeHead(status, { Location: next })
    res.end()
    return
  }

  // /status/:code — respond with the requested status code.
  const statusMatch = path.match(/^\/status\/(\d+)$/)
  if (statusMatch) {
    const code = Number(statusMatch[1])
    sendJson(res, code, { status: code, message: `Responded with ${code}` }, { 'X-Status-Echo': String(code) })
    return
  }

  // /cookie/set — set a cookie the jar must store.
  if (path === '/cookie/set') {
    const name = query.name || 'session'
    const value = query.value || 'abc123'
    res.writeHead(200, {
      'Set-Cookie': `${name}=${value}; Path=/`,
      'Content-Type': 'application/json'
    })
    res.end(JSON.stringify({ set: { [name]: value } }))
    return
  }

  // /cookie/echo — reflect the received Cookie header.
  if (path === '/cookie/echo') {
    sendJson(res, 200, { cookie: req.headers.cookie || '' })
    return
  }

  // /binary — a deterministic binary payload (PNG magic bytes + data).
  if (path === '/binary') {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd])
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buf.length) })
    res.end(buf)
    return
  }

  // /xml — an application/xml document.
  if (path === '/xml') {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<note><to>restorm</to><body>hello</body></note>'
    res.writeHead(200, { 'Content-Type': 'application/xml' })
    res.end(xml)
    return
  }

  // /html — a text/html document.
  if (path === '/html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!DOCTYPE html><html><body><h1>restorm</h1></body></html>')
    return
  }

  // /multi-header — a genuine multi-value response header.
  if (path === '/multi-header') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Multi': ['one', 'two'] })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // /slow — respond after the requested delay (cancellation / timeout).
  if (path === '/slow') {
    const ms = query.ms ? Number(query.ms) : 5000
    setTimeout(() => {
      sendJson(res, 200, { slow: true, waitedMs: ms })
    }, ms)
    return
  }

  // Fallthrough.
  sendJson(res, 404, { error: 'Not found', path })
})

// llhttp (Node's HTTP parser) rejects any method token outside its canonical
// UPPERCASE list before the request handler runs — a custom-cased `post` or a
// server-defined `Machin` would 400 at the parser. The raw bytes are still
// visible in the clientError hook: echo the method token back manually so
// clients can prove their wire sends the token verbatim.
server.on('clientError', (err, socket) => {
  const raw = err && err.rawPacket ? err.rawPacket.toString('utf-8') : ''
  const m = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+) \S+ HTTP\/1\.[01]\r\n/.exec(raw)
  if (m && err.code === 'HPE_INVALID_METHOD' && socket.writable) {
    const body = JSON.stringify({ method: m[1], rawMethodEcho: true })
    socket.end(
      'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ' +
      Buffer.byteLength(body) + '\r\nConnection: close\r\n\r\n' + body
    )
    return
  }
  socket.destroy(err)
})

server.listen(PORT, () => {
  console.log(`http-util mock listening on :${PORT}`)
})

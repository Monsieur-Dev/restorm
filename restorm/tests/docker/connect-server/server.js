/**
 * Connect-RPC mock server for the restorm gRPC-execution E2E suite's Connect
 * transport scenarios.
 *
 * There's no ready-made local Connect-RPC container to reuse
 * (`connectrpc/eliza` is a public demo, not a local image) — same situation
 * as the gRPC-Web scenario, which gets its own hand-rolled mock
 * (`grpcweb-server/server.js`; `moul/grpcbin` doesn't speak gRPC-Web on any
 * port). This is a tiny zero-dependency Node server instead, mirroring the
 * `soap-server` / `http-util` precedent: pure `node:http`, no npm install,
 * boots the instant the container starts.
 *
 * It answers the same `grpcbin.GRPCBin` service/method names the bundled
 * fallback proto (`GRPCBIN_PROTO` in `grpcProtoLoader.ts`) declares, so an
 * E2E request needs no custom `.proto` — only `transport: 'connect'` and a
 * URL pointing here instead of grpcbin's ports.
 *
 * Routes:
 *   POST /grpcbin.GRPCBin/DummyUnary        — Connect unary protocol
 *     (`Content-Type: application/json`, unenveloped body): echoes the
 *     request's `f_string` back in the response, or returns a Connect error
 *     JSON (`{ code, message }`) when the request carries `f_string ===
 *     'ERROR'`, exercising the client's error-mapping path.
 *
 *   POST /grpcbin.GRPCBin/DummyServerStream — Connect streaming protocol
 *     (`Content-Type: application/connect+json`, enveloped body): sends the
 *     request's `f_string` back as 3 enveloped DATA frames, then one
 *     END-STREAM envelope with no error.
 *
 *   GET  /health — 200 "ok" (readiness probe).
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 8093

/** Read the full request body into a Buffer. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.alloc(0)))
  })
}

/** Encode one Connect streaming envelope (5-byte header: flags + BE32 length). */
function encodeEnvelope(flags, payload) {
  const header = Buffer.alloc(5)
  header.writeUInt8(flags, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  // GET /health — readiness probe.
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }

  const body = await readBody(req)

  // POST /grpcbin.GRPCBin/DummyUnary — plain JSON in, plain JSON (or error) out.
  if (path === '/grpcbin.GRPCBin/DummyUnary') {
    let requestMessage
    try {
      requestMessage = JSON.parse(body.toString('utf-8') || '{}')
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'invalid_argument', message: 'request body is not valid JSON' }))
      return
    }
    if (requestMessage.f_string === 'ERROR') {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'internal', message: 'connect-mock-error-mapping-test' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ f_string: requestMessage.f_string ?? '' }))
    return
  }

  // POST /grpcbin.GRPCBin/DummyServerStream — enveloped streaming echo.
  if (path === '/grpcbin.GRPCBin/DummyServerStream') {
    let requestMessage
    try {
      // The request body is itself one enveloped message; skip the 5-byte
      // header and parse the JSON payload after it.
      requestMessage = JSON.parse(body.subarray(5).toString('utf-8') || '{}')
    } catch {
      requestMessage = {}
    }
    res.writeHead(200, { 'Content-Type': 'application/connect+json' })
    for (let i = 0; i < 3; i++) {
      res.write(encodeEnvelope(0, Buffer.from(JSON.stringify({ f_string: requestMessage.f_string ?? '' }))))
    }
    res.end(encodeEnvelope(0x02, Buffer.from('{}')))
    return
  }

  // Unknown route — generic Connect-shaped not_found error.
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ code: 'not_found', message: `unknown method: ${path}` }))
})

server.listen(PORT, () => {
  console.log(`connect-server mock listening on :${PORT}`)
})

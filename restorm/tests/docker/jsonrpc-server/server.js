/**
 * JSON-RPC 2.0 mock server for the `jsonrpc-execution` E2E suite. Mirrors
 * the `http-util` / `odata-v2-petstore` precedent — a tiny, dependency-free
 * `node:http` server, so CI boots it with a bare `node server.js` (no
 * `npm install`).
 *
 * Everything is dispatched off a single POST endpoint (`/rpc`), per the
 * JSON-RPC 2.0 spec: the body is either one envelope (single call) or a
 * JSON array of envelopes (batch). A notification (no `id`) still gets a
 * 204 response with no body — there's nothing to correlate a reply to,
 * but an HTTP POST needs SOME response.
 *
 * Routes:
 *   GET  /health       → 200 "ok" (readiness probe).
 *   GET  /openrpc.json → the OpenRPC document describing the methods below,
 *                        self-referencing this server as `servers[0].url` —
 *                        lets the e2e import suite `import_from_url` this
 *                        endpoint and immediately run a generated request
 *                        against the same mock.
 *   POST /rpc          → single envelope or batch array.
 *
 * Methods:
 *   echo(a, b)        → positional params; returns `[a, b]` echoed back.
 *   namedEcho({...})  → named params; returns the object echoed back.
 *   failMethod()      → always returns a JSON-RPC error (code -32000).
 *   add(a, b)         → positional params; returns `a + b` (used by the
 *                       batch e2e scenario alongside echo/namedEcho so a
 *                       batch can mix multiple distinct methods).
 *   slow()            → resolves after an 8s delay — used by the
 *                       cancellation scenario (send, immediately cancel,
 *                       assert the panel returns to idle with no result).
 * Any other method name → JSON-RPC "Method not found" (-32601).
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 8095

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callMethod(name, params) {
  switch (name) {
    case 'echo':
      return { result: Array.isArray(params) ? params : [params] }
    case 'namedEcho':
      return { result: params && typeof params === 'object' ? params : {} }
    case 'add': {
      const [a, b] = Array.isArray(params) ? params : [params?.a, params?.b]
      return { result: Number(a) + Number(b) }
    }
    case 'failMethod':
      return { error: { code: -32000, message: 'failMethod always fails.', data: { reason: 'intentional' } } }
    case 'slow':
      await delay(8000)
      return { result: 'done' }
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${name}` } }
  }
}

/** Execute one envelope; returns a response envelope, or `null` for a
 * notification (no `id` present — no reply expected). */
async function dispatchOne(envelope) {
  if (!envelope || typeof envelope !== 'object' || envelope.jsonrpc !== '2.0' || typeof envelope.method !== 'string') {
    return { jsonrpc: '2.0', id: envelope && envelope.id !== undefined ? envelope.id : null, error: { code: INVALID_REQUEST, message: 'Invalid Request' } }
  }
  const isNotification = !('id' in envelope)
  const outcome = await callMethod(envelope.method, envelope.params)
  if (isNotification) return null
  return outcome.error !== undefined
    ? { jsonrpc: '2.0', id: envelope.id, error: outcome.error }
    : { jsonrpc: '2.0', id: envelope.id, result: outcome.result }
}

// ---------------------------------------------------------------------------
// OpenRPC document — self-describes the methods above with this server's
// own URL, so the e2e import suite can import it and run a generated
// request against the very server that served the document.
// ---------------------------------------------------------------------------

function openRpcDocument() {
  return {
    openrpc: '1.2.6',
    info: { title: 'restorm JSON-RPC mock', version: '1.0.0' },
    servers: [{ name: 'mock', url: `http://localhost:${PORT}/rpc` }],
    methods: [
      {
        name: 'echo',
        summary: 'Echoes back its positional arguments.',
        paramStructure: 'by-position',
        params: [{ name: 'value', schema: { type: 'string' } }],
        result: { name: 'result', schema: { type: 'string' } }
      },
      {
        name: 'namedEcho',
        summary: 'Echoes back a named object.',
        paramStructure: 'by-name',
        params: [{ name: 'value', schema: { type: 'string' } }],
        result: { name: 'result', schema: { type: 'object' } }
      },
      {
        name: 'failMethod',
        summary: 'Always returns a JSON-RPC error.',
        params: [],
        result: { name: 'result', schema: { type: 'null' } }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  if (url.pathname === '/openrpc.json' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(openRpcDocument(), null, 2))
    return
  }

  if (url.pathname === '/rpc' && req.method === 'POST') {
    const raw = await readBody(req)
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Parse error' } }))
      return
    }

    if (Array.isArray(parsed)) {
      const all = await Promise.all(parsed.map(dispatchOne))
      const responses = all.filter((r) => r !== null)
      // A batch of ALL notifications gets no body — same 204 rule as a
      // single notification.
      if (responses.length === 0) {
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(responses))
      return
    }

    const response = await dispatchOne(parsed)
    if (response === null) {
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: `No route for ${req.method} ${url.pathname}` }))
})

server.listen(PORT, () => {
  console.log(`jsonrpc mock listening on :${PORT}`)
})

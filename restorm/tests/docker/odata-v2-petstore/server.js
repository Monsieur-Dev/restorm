/**
 * OData v2 mock server for the restorm OData execution + import E2E suite.
 *
 * The .NET `odata-petstore` (:5100) is a full v4 AspNetCoreOData service;
 * this companion exists only to exercise the v2 code paths Restorm has to
 * support: the `{ d: { results, __count, __next } }` response envelope,
 * the `$inlinecount=allpages` query option (v2's `$count`), the older
 * CSDL `$metadata` shape, and server-driven paging via `__next`.
 *
 * It mirrors the `http-util` / `graphql-server` precedent — a tiny,
 * dependency-free `node:http` server so CI can boot it with a bare
 * `node server.js &` (no `npm install`).
 *
 * Data resets to the seed below on every process start, so write
 * scenarios stay deterministic when the container is fresh; the e2e
 * write scenarios are additionally self-cleaning (POST → GET → DELETE
 * the same entity) so repeated runs against a warm server still pass.
 *
 * Routes (service root `/`):
 *   GET    /health                  → 200 "ok" (readiness probe).
 *   GET    /$metadata               → v2 CSDL EDMX (application/xml).
 *   GET    /Products                → list; honours $inlinecount,
 *                                     $top, $skip, $filter (Name eq '…'),
 *                                     $select; emits __next when paged.
 *   GET    /Products(<id>)          → single entity ({ d: { … } }) or 404.
 *   POST   /Products                → create (returns 201 + { d }).
 *   PATCH  /Products(<id>)          → update (204) or 404.
 *   DELETE /Products(<id>)          → delete (204) or 404.
 *   GET    /Categories             → list (same envelope).
 *   GET    /GetProductsByRating     → v2 FunctionImport (?rating=).
 *   GET    /error400                → v2/JSON OData error envelope.
 *   POST   /$batch                  → multipart/mixed OR JSON batch.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT ? Number(process.env.PORT) : 5102

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

function seedProducts() {
  return [
    { ID: 1, Name: 'Bread', Description: 'Whole grain', Price: 2.5, Rating: 4 },
    { ID: 2, Name: 'Milk', Description: 'Semi-skimmed', Price: 1.2, Rating: 5 },
    { ID: 3, Name: 'Eggs', Description: 'Free range', Price: 3.0, Rating: 3 },
    { ID: 4, Name: 'Cheese', Description: 'Aged cheddar', Price: 5.4, Rating: 5 },
    { ID: 5, Name: 'Butter', Description: 'Salted', Price: 2.1, Rating: 4 }
  ]
}

const CATEGORIES = [
  { ID: 1, Name: 'Bakery' },
  { ID: 2, Name: 'Dairy' }
]

let products = seedProducts()
let nextId = 6

// ---------------------------------------------------------------------------
// v2 CSDL $metadata — single source of truth in metadata.xml (also used as
// the offline import fixture), read once at boot.
// ---------------------------------------------------------------------------

const METADATA = fs.readFileSync(path.join(__dirname, 'metadata.xml'), 'utf-8')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.concat(chunks)))
  })
}

/** v2 wraps collections in `{ d: { results: [...] } }` and single
 * entities in `{ d: { ...fields } }`. */
function sendV2Collection(res, results, { count, nextLink } = {}) {
  const d = { results }
  if (count !== undefined) d.__count = String(count)
  if (nextLink !== undefined) d.__next = nextLink
  res.writeHead(200, { 'Content-Type': 'application/json', 'DataServiceVersion': '2.0' })
  res.end(JSON.stringify({ d }))
}

function sendV2Entity(res, status, entity) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'DataServiceVersion': '2.0' })
  res.end(JSON.stringify({ d: entity }))
}

function sendODataError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { code, message: { lang: 'en-US', value: message } } }))
}

/** Apply the v2 query options we support. Returns `{ page, count }`. */
function applyQuery(all, query) {
  let rows = all.slice()

  // $filter — support the single equality form `Name eq 'value'` used by
  // the e2e matrix. Anything else is ignored (returns all rows).
  const filter = query.get('$filter')
  if (filter) {
    const eq = /^\s*(\w+)\s+eq\s+'([^']*)'\s*$/.exec(filter)
    if (eq) {
      const [, field, value] = eq
      rows = rows.filter((r) => String(r[field]) === value)
    }
  }

  const total = rows.length

  const skip = Number(query.get('$skip') || '0')
  if (skip > 0) rows = rows.slice(skip)
  const top = query.get('$top') ? Number(query.get('$top')) : undefined
  if (top !== undefined) rows = rows.slice(0, top)

  // $select — project the requested fields.
  const select = query.get('$select')
  if (select) {
    const fields = select.split(',').map((s) => s.trim()).filter(Boolean)
    rows = rows.map((r) => {
      const out = {}
      for (const f of fields) if (f in r) out[f] = r[f]
      return out
    })
  }

  return { page: rows, total, skip, top }
}

// ---------------------------------------------------------------------------
// $batch (multipart + JSON)
// ---------------------------------------------------------------------------

/** Dispatch a single sub-request against the in-memory store and return
 * `{ status, body }`. Only the verbs the e2e batch scenarios use are
 * handled; anything else yields a 501 so the test surfaces it. */
function dispatchSub(method, url, rawBody) {
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '')
  const keyMatch = /^Products\((\d+)\)$/.exec(path)
  if (path === 'Products' && method === 'GET') {
    return { status: 200, body: { d: { results: products } } }
  }
  if (path === 'Products' && method === 'POST') {
    const parsed = rawBody ? safeJson(rawBody) : {}
    const created = { ID: nextId++, Name: '', Description: '', Price: 0, Rating: 0, ...parsed }
    products.push(created)
    return { status: 201, body: { d: created } }
  }
  if (keyMatch) {
    const id = Number(keyMatch[1])
    const idx = products.findIndex((p) => p.ID === id)
    if (method === 'GET') {
      return idx >= 0
        ? { status: 200, body: { d: products[idx] } }
        : { status: 404, body: { error: { code: 'NotFound', message: { value: `Product ${id} not found` } } } }
    }
    if (method === 'PATCH' || method === 'PUT') {
      if (idx < 0) return { status: 404, body: { error: { code: 'NotFound', message: { value: 'not found' } } } }
      products[idx] = { ...products[idx], ...safeJson(rawBody) }
      return { status: 204, body: null }
    }
    if (method === 'DELETE') {
      if (idx < 0) return { status: 404, body: { error: { code: 'NotFound', message: { value: 'not found' } } } }
      products.splice(idx, 1)
      return { status: 204, body: null }
    }
  }
  return { status: 501, body: { error: { code: 'NotImplemented', message: { value: `${method} ${path}` } } } }
}

function safeJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/** Parse + execute a JSON `$batch` (`{ requests: [...] }`). Honours
 * change-sets: if any sub-request in an atomicityGroup fails, all of
 * that group's writes are rolled back and reported as failed. */
function handleJsonBatch(rawBody) {
  const doc = safeJson(rawBody)
  const requests = Array.isArray(doc.requests) ? doc.requests : []

  // Group by atomicityGroup so we can roll back a failed change-set.
  const responses = []
  const groups = new Map()
  for (const r of requests) {
    const g = r.atomicityGroup || null
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(r)
  }

  for (const [group, subs] of groups) {
    if (group === null) {
      for (const r of subs) {
        const out = dispatchSub(r.method, r.url, r.body !== undefined ? JSON.stringify(r.body) : undefined)
        responses.push({ id: r.id, status: out.status, headers: { 'content-type': 'application/json' }, ...(out.body !== null ? { body: out.body } : {}) })
      }
      continue
    }
    // Change-set: snapshot, apply, roll back on any failure.
    const snapshot = JSON.parse(JSON.stringify(products))
    const snapshotNextId = nextId
    const groupResponses = []
    let failed = false
    for (const r of subs) {
      const out = dispatchSub(r.method, r.url, r.body !== undefined ? JSON.stringify(r.body) : undefined)
      groupResponses.push({ id: r.id, status: out.status, headers: { 'content-type': 'application/json' }, ...(out.body !== null ? { body: out.body } : {}) })
      if (out.status >= 400) { failed = true; break }
    }
    if (failed) {
      products = snapshot
      nextId = snapshotNextId
      // Report every member of the failed change-set as 424 (the OData
      // convention for "failed dependency in the change-set").
      for (const r of subs) responses.push({ id: r.id, status: 424, body: { error: { code: 'ChangeSetFailed', message: { value: 'change-set rolled back' } } } })
    } else {
      responses.push(...groupResponses)
    }
  }

  return JSON.stringify({ responses })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const query = url.searchParams
  const method = req.method || 'GET'

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  if (path === '/$metadata') {
    res.writeHead(200, { 'Content-Type': 'application/xml', 'DataServiceVersion': '2.0' })
    res.end(METADATA)
    return
  }

  // Reset endpoint — lets a test restore the seed without a restart.
  if (path === '/reset' && method === 'POST') {
    products = seedProducts()
    nextId = 6
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ reset: true }))
    return
  }

  if (path === '/error400') {
    sendODataError(res, 400, 'BadRequest', 'The query specified is not valid.')
    return
  }

  if (path === '/$batch' && method === 'POST') {
    const raw = (await readBody(req)).toString('utf-8')
    const contentType = req.headers['content-type'] || ''
    if (contentType.includes('application/json')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'DataServiceVersion': '2.0' })
      res.end(handleJsonBatch(raw))
      return
    }
    // Multipart batch — a minimal echo that reports each sub-request as a
    // 200 so the multipart scenario can assert the round-trip. (The v4
    // .NET mock covers the full multipart semantics; here we only need
    // the v2 envelope path to exist.)
    const boundary = `batchresponse_${Date.now().toString(36)}`
    const parts = raw.split(/--changeset_[^\r\n]+|--batch_[^\r\n]+/).filter((p) => /HTTP\/1\.1/.test(p) || /GET|POST|PATCH|DELETE/.test(p))
    const body = parts.map(() =>
      `--${boundary}\r\nContent-Type: application/http\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"d":{"results":[]}}\r\n`
    ).join('') + `--${boundary}--\r\n`
    res.writeHead(202, { 'Content-Type': `multipart/mixed; boundary=${boundary}`, 'DataServiceVersion': '2.0' })
    res.end(body)
    return
  }

  if (path === '/GetProductsByRating' && method === 'GET') {
    const rating = query.get('rating')
    const rows = rating ? products.filter((p) => String(p.Rating) === rating) : products
    sendV2Collection(res, rows)
    return
  }

  if (path === '/Categories' && method === 'GET') {
    sendV2Collection(res, CATEGORIES, { count: query.get('$inlinecount') === 'allpages' ? CATEGORIES.length : undefined })
    return
  }

  // /Products and /Products(<id>)
  const productKey = /^\/Products\((\d+)\)$/.exec(path)
  if (productKey) {
    const id = Number(productKey[1])
    const idx = products.findIndex((p) => p.ID === id)
    if (method === 'GET') {
      if (idx < 0) return sendODataError(res, 404, 'NotFound', `Product ${id} does not exist.`)
      return sendV2Entity(res, 200, products[idx])
    }
    if (method === 'PATCH' || method === 'PUT') {
      if (idx < 0) return sendODataError(res, 404, 'NotFound', `Product ${id} does not exist.`)
      products[idx] = { ...products[idx], ...safeJson((await readBody(req)).toString('utf-8')) }
      res.writeHead(204, { 'DataServiceVersion': '2.0' })
      res.end()
      return
    }
    if (method === 'DELETE') {
      if (idx < 0) return sendODataError(res, 404, 'NotFound', `Product ${id} does not exist.`)
      products.splice(idx, 1)
      res.writeHead(204, { 'DataServiceVersion': '2.0' })
      res.end()
      return
    }
  }

  if (path === '/Products') {
    if (method === 'GET') {
      const { page, total, skip, top } = applyQuery(products, query)
      const wantsCount = query.get('$inlinecount') === 'allpages'
      // Server-driven paging: when $top is set and more rows remain,
      // advertise a __next link so the "Load next page" button has work.
      let nextLink
      if (top !== undefined && skip + top < total) {
        const nextSkip = skip + top
        nextLink = `${url.origin}/Products?$top=${top}&$skip=${nextSkip}`
      }
      return sendV2Collection(res, page, {
        ...(wantsCount ? { count: total } : {}),
        ...(nextLink ? { nextLink } : {})
      })
    }
    if (method === 'POST') {
      const parsed = safeJson((await readBody(req)).toString('utf-8'))
      const created = { ID: nextId++, Name: '', Description: '', Price: 0, Rating: 0, ...parsed }
      products.push(created)
      return sendV2Entity(res, 201, created)
    }
  }

  sendODataError(res, 404, 'NotFound', `No route for ${method} ${path}`)
})

server.listen(PORT, () => {
  console.log(`odata-v2-petstore mock listening on :${PORT}`)
})

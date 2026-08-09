/**
 * OData Mock Server Service
 *
 * Makes restorm ACT AS a local OData v4 service. It serves a user-supplied
 * `$metadata` (CSDL) document verbatim, exposes the entity-set collection +
 * by-key routes derived by re-parsing that CSDL, honours the system query
 * options ($filter / $select / $orderby / $top / $skip / $count / $expand)
 * over the served entity data, and dispatches a `$batch` multipart request.
 *
 * Like the SOAP/GraphQL HTTP-family mocks, an OData service rides the shared
 * HTTP/1.1 `PortHost` in {@link WebSocketExecutionService}: it registers a
 * single `matchPrefix` route per method on its service-root path and dispatches
 * every sub-path internally, so one OData server owns its whole `/odata/*`
 * sub-tree without pre-registering each dynamic key.
 *
 * Two entry points mirror the HTTP mock ({@link import('./HTTPExecutionService')}):
 *  - `listen()` / `stopListening()` — the request-panel Listen↔Stop toggle.
 *  - `connectStreamingODataServer()` — a long-lived bridge for the scenario
 *    `odataListen` node (re-emits each served request on the node's `served`
 *    port).
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { websocketExecutionService } from './WebSocketExecutionService'
import { parseEdmxV4, type EdmSchema, type EdmEntityType } from './import/ODataImportService'
import { applyODataQuery, parsePagingValue, type ODataEntity, type ExpandResolver } from '../../shared/utils/odataServerQuery'
import { extractBoundary } from '../../shared/utils/odataBatch'
import type { ODataRequest } from '../../shared/types/requests/ODataRequest'

/** Default port a freshly-created OData mock server binds (adjacent to the bare
 * HTTP mock's 8080). */
export const DEFAULT_ODATA_SERVER_PORT = 8081

/** Default service root a freshly-created OData mock server hosts. */
export const DEFAULT_ODATA_SERVICE_ROOT = '/odata'

/** OData v4 entity collection / single-entity payloads carry this media type. */
const ODATA_JSON_CONTENT_TYPE = 'application/json; odata.metadata=minimal'
const XML_CONTENT_TYPE = 'application/xml'

/** One served OData request surfaced on a scenario `odataListen` node's `served`
 * output (shape mirrors the `{ request, response }` an httpListen node emits, so
 * a JSON-path picker drills it the same way). */
interface ServedSummary {
  request: { method: string; url: string; headers: Record<string, string> }
  response: { status: number; headers: Record<string, string>; body: string }
}

/** Compiled view of a hosted service: the CSDL plus the derived route table. */
interface ServiceModel {
  metadata: string
  schema: EdmSchema
  /** entity-set name → entity type (for key + property validation). */
  entityTypeBySet: Map<string, EdmEntityType>
  /** qualified entity-type name (and its bare name) → the entity SET that
   * exposes it, so a nav property's target type resolves to the served set
   * (CSDL-driven — no fragile name pluralization). */
  setByType: Map<string, string>
  /** Served data, keyed by entity-set name. */
  data: Record<string, ODataEntity[]>
  /** The service-root path the routes are registered under (e.g. `/odata`). */
  serviceRoot: string
}

/** A live hosted OData service (one per listening request). */
interface ActiveService {
  requestId: string
  model: ServiceModel
  /** Re-emit each served request (scenario `odataListen` bridge); undefined for
   * the plain request-panel Listen path. */
  onServed?: (summary: ServedSummary) => void
}

class ODataMockServerService {
  /** Hosted services, keyed by requestId (one service per listening request). */
  private services = new Map<string, ActiveService>()
  /** Per-request served-request counter (drives the "served N" banner). */
  private servedCounts = new Map<string, number>()

  /**
   * SERVER MODE (Listen button): start hosting `requestId`'s OData mock. Resolves
   * once the routes are registered (or fail to bind).
   */
  async listen(requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> {
    if (this.services.has(requestId)) {
      return { success: true, listening: true }
    }
    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)
    try {
      await this.bringUpServer(requestId, {
        onStopped: (error) => {
          this.servedCounts.delete(requestId)
          this.broadcastProgress(requestId, error ? 'error' : 'completed')
        }
      })
      return { success: true, listening: true }
    } catch (err) {
      this.servedCounts.delete(requestId)
      this.broadcastProgress(requestId, 'error')
      return { success: false, listening: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * SCENARIO server node ({@link import('../scenarioEngine/executors/socketioExecutors').odataListenExecutor}):
   * HOST this request's OData mock as a LONG-LIVED listener and bridge it to the
   * scheduler's connect machinery. `connect` = listen, each served request
   * re-emits via `onMessage` (→ the `served` port), `close` = stop the service
   * (→ the node's `done`). Stays up until `close()` (an odataClose node) or a
   * Stop — exactly like the HTTP mock server.
   */
  connectStreamingODataServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      this.servedCounts.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      input.onClose(error)
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    void this.bringUpServer(requestId, {
      onServed: (summary) => { input.onMessage(undefined, summary) },
      onStopped: (error) => { fireClose(error) }
    })
      .then(() => { input.onConnect() })
      .catch((err: unknown) => { fireClose(err instanceof Error ? err.message : String(err)) })

    return {
      // A hosted OData mock never SENDS unprompted — it only answers inbound
      // requests — so `send` is a no-op (there is no odataSend node).
      send: () => false,
      close: () => { this.stopListening(requestId) },
      isOpen: () => this.isListening(requestId)
    }
  }

  /** Stop hosting this request's OData mock (the Stop button / an odataClose
   * node). Frees the shared port once it was the last route. Idempotent. */
  stopListening(requestId: string): boolean {
    if (!this.services.has(requestId)) return false
    this.services.delete(requestId)
    this.servedCounts.delete(requestId)
    return websocketExecutionService.disconnect(requestId)
  }

  /** Whether this request is currently hosting an OData mock service. */
  isListening(requestId: string): boolean {
    return this.services.has(requestId)
  }

  /** Tear down EVERY hosted OData service (file close + app quit). The shared
   * PortHost routes are released via {@link WebSocketExecutionService.disconnect}
   * so no port leaks. */
  closeAll(): void {
    for (const requestId of [...this.services.keys()]) {
      this.stopListening(requestId)
    }
  }

  /** The mock address with its Handlebars expressions substituted — port and
   * path are expression fields like a client URL. Falls back to the raw url
   * when no resolution exists, so a plain literal keeps working unchanged. */
  private resolvedMockUrl(requestId: string, rawUrl: string): string {
    const resolved = contextService.resolveUrlForRequest(requestId)?.resolvedUrl
    return resolved && resolved.trim().length > 0 ? resolved : rawUrl
  }

  /** Resolve the request's config, compile the CSDL into a route model, and
   * register the service-root prefix routes on the shared HTTP PortHost. */
  private async bringUpServer(
    requestId: string,
    hooks: { onServed?: (summary: ServedSummary) => void; onStopped?: (error?: string) => void }
  ): Promise<void> {
    const fullData = contextService.getRequestContext(requestId)?.fullData as ODataRequest | undefined
    const { port, serviceRoot } = parseServiceAddress(this.resolvedMockUrl(requestId, fullData?.url ?? ''))
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error('A valid localhost port is required for an OData mock server')
    }
    const metadata = (fullData?.mockMetadata ?? '').trim()
    if (metadata === '') {
      throw new Error('An OData mock server requires a $metadata (CSDL) document')
    }

    const schema = parseEdmxV4(metadata)
    const entityTypeBySet = new Map<string, EdmEntityType>()
    const setByType = new Map<string, string>()
    for (const set of schema.entitySets) {
      const type = schema.entityTypes.find((t) => t.qualifiedName === set.entityType || t.name === stripNamespace(set.entityType))
      if (type) entityTypeBySet.set(set.name, type)
      // Index BOTH the qualified + bare type name so a nav property's target type
      // (which the CSDL may write either way) maps back to its served set.
      setByType.set(set.entityType, set.name)
      setByType.set(stripNamespace(set.entityType), set.name)
    }

    const model: ServiceModel = {
      metadata,
      schema,
      entityTypeBySet,
      setByType,
      data: fullData?.mockData ?? {},
      serviceRoot
    }
    const active: ActiveService = { requestId, model, onServed: hooks.onServed }
    this.services.set(requestId, active)

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      this.serve(active, req, res)
    }

    // ONE `*`-method prefix route claims the whole service-root sub-tree so a
    // single registration (one route per requestId → clean disconnect) answers
    // the GET reads ($metadata / collection / by-key / $count) AND the POST
    // `$batch`. The service dispatches by method + sub-path internally.
    const onStopped = (error?: string): void => {
      this.services.delete(requestId)
      hooks.onStopped?.(error)
    }
    const result = await websocketExecutionService.listenHttpServer({
      requestId, method: '*', port, path: serviceRoot, onRequest: handler, onStopped, matchPrefix: true
    })
    if (!result.listening) {
      this.services.delete(requestId)
      throw new Error(result.error ?? `failed to start OData mock server for ${requestId}`)
    }
    logger.info('[ODataMockServerService] OData mock listening', { requestId, port, serviceRoot, entitySets: schema.entitySets.map((s) => s.name) })
  }

  /** Dispatch one inbound request to the right OData sub-handler. */
  private serve(active: ActiveService, req: IncomingMessage, res: ServerResponse): void {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = req.url ?? '/'
    const root = active.model.serviceRoot
    const pathname = stripQuery(url)
    // Sub-path relative to the service root (`/odata/Pets(1)` → `/Pets(1)`).
    const rel = pathname.startsWith(root) ? pathname.slice(root.length) : pathname
    const query = parseQuery(url)

    void (async () => {
      try {
        if (method === 'POST' && trimSlashes(rel) === '$batch') {
          await this.serveBatch(active, req, res)
          return
        }
        if (method !== 'GET') {
          this.writeJson(active, req, res, 405, { error: { code: '405', message: 'Method not supported by the mock' } })
          return
        }
        if (trimSlashes(rel) === '$metadata') {
          this.writeRaw(active, req, res, 200, XML_CONTENT_TYPE, active.model.metadata)
          return
        }
        if (trimSlashes(rel) === '' || trimSlashes(rel) === '/') {
          // Service document: list the entity sets.
          this.writeJson(active, req, res, 200, {
            '@odata.context': `${root}/$metadata`,
            value: active.model.schema.entitySets.map((s) => ({ name: s.name, kind: 'EntitySet', url: s.name }))
          })
          return
        }
        this.serveEntityPath(active, req, res, trimSlashes(rel), query)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.writeJson(active, req, res, 400, { error: { code: '400', message } })
      }
    })()
  }

  /** Serve an entity-set collection, a by-key single entity, or a `/$count`. */
  private serveEntityPath(
    active: ActiveService,
    req: IncomingMessage,
    res: ServerResponse,
    rel: string,
    query: Record<string, string>
  ): void {
    const root = active.model.serviceRoot
    // `Pets`, `Pets(1)`, `Pets/$count`, `Pets(1)/Category`.
    const segments = rel.split('/')
    const head = segments[0] ?? ''
    const setMatch = /^([^(]+)(?:\(([^)]*)\))?$/.exec(head)
    if (!setMatch) {
      this.writeJson(active, req, res, 404, { error: { code: '404', message: `No such resource: ${rel}` } })
      return
    }
    const setName = setMatch[1] ?? ''
    const rawKey = setMatch[2]
    const collection: ODataEntity[] | undefined = active.model.data[setName]
    if (collection === undefined) {
      this.writeJson(active, req, res, 404, { error: { code: '404', message: `No entity set "${setName}"` } })
      return
    }
    const entityType = active.model.entityTypeBySet.get(setName)
    const resolver = this.makeExpandResolver(active, entityType)

    // `Pets/$count` — a bare integer count of the (optionally filtered) set.
    if (segments[1] === '$count') {
      const { count } = applyODataQuery(collection, { ...parseSystemOptions(query), count: true })
      this.writeRaw(active, req, res, 200, 'text/plain', String(count ?? collection.length))
      return
    }

    // By-key single entity: `Pets(1)`.
    if (rawKey !== undefined) {
      const entity = this.findByKey(collection, entityType, rawKey)
      if (!entity) {
        this.writeJson(active, req, res, 404, { error: { code: '404', message: `No ${setName} with key ${rawKey}` } })
        return
      }
      const options = parseSystemOptions(query)
      // A by-key read honours $select + $expand (paging/filter/orderby don't apply).
      const { value } = applyODataQuery([entity], { select: options.select, expand: options.expand }, resolver)
      this.writeJson(active, req, res, 200, { '@odata.context': `${root}/$metadata#${setName}/$entity`, ...value[0] })
      return
    }

    // Collection read with the full system-query-option set applied.
    const { value, count } = applyODataQuery(collection, parseSystemOptions(query), resolver)
    const body: Record<string, unknown> = { '@odata.context': `${root}/$metadata#${setName}`, value }
    if (count !== undefined) body['@odata.count'] = count
    this.writeJson(active, req, res, 200, body)
  }

  /** Resolve a navigation property's related rows for `$expand`. An embedded
   * value already on the entity wins (hand-authored sample data). Otherwise the
   * CSDL drives it: the source type's NavigationProperty gives the target entity
   * type → its served set; a to-many nav returns the whole set, a to-one matches
   * the foreign key `<NavProp>Id` against the target set's key. Unknown nav
   * properties return `undefined` (left untouched). */
  private makeExpandResolver(active: ActiveService, sourceType: EdmEntityType | undefined): ExpandResolver {
    return (entity, navProperty) => {
      if (navProperty in entity) return entity[navProperty]
      const navDef = sourceType?.navigationProperties.find((n) => n.name === navProperty)
      if (!navDef) return undefined
      const targetType = unwrapCollectionType(navDef.type)
      const setName = active.model.setByType.get(targetType) ?? active.model.setByType.get(stripNamespace(targetType))
      if (setName === undefined) return undefined
      const rows = active.model.data[setName]
      if (!rows) return undefined
      // To-many (`Collection(...)`): the related collection. To-one: match the
      // FK `<NavProp>Id` against the target set's key.
      if (navDef.collection) return rows
      const keyProp = active.model.entityTypeBySet.get(setName)?.keys[0] ?? 'Id'
      const fk = entity[`${navProperty}Id`]
      if (fk === undefined) return undefined
      return rows.find((r) => r[keyProp] === fk)
    }
  }

  /** Find a single entity by its (single) key. Numeric keys are matched against a
   * numeric key value; quoted string keys against a string key value. */
  private findByKey(
    collection: ODataEntity[],
    entityType: EdmEntityType | undefined,
    rawKey: string
  ): ODataEntity | undefined {
    const keyProp = entityType?.keys[0] ?? 'Id'
    const trimmed = rawKey.trim()
    const value: unknown =
      trimmed.startsWith("'") && trimmed.endsWith("'")
        ? trimmed.slice(1, -1).replace(/''/g, "'")
        : /^-?\d+$/.test(trimmed)
          ? Number(trimmed)
          : trimmed
    return collection.find((row) => row[keyProp] === value)
  }

  /** Parse + dispatch a `$batch` multipart/mixed request, executing each GET
   * sub-request through the same entity-path logic and assembling a multipart
   * response. (Write sub-requests are accepted but answered 501 — v1 serves
   * reads; change-set mutation is out of scope.) */
  private async serveBatch(active: ActiveService, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const boundary = extractBoundary(headerValue(req, 'content-type'))
    const rawBody = await readBody(req)
    if (!boundary) {
      this.writeJson(active, req, res, 400, { error: { code: '400', message: '$batch requires a multipart/mixed body' } })
      return
    }
    const subRequests = parseBatchRequest(rawBody, boundary)
    const responseBoundary = `batchresponse_${randomToken()}`
    const parts: string[] = subRequests.map((sub) => this.executeBatchSubRequest(active, sub))
    const body = parts.map((p) => `--${responseBoundary}\r\nContent-Type: application/http\r\n\r\n${p}`).join('\r\n') + `\r\n--${responseBoundary}--\r\n`
    this.writeRaw(active, req, res, 200, `multipart/mixed; boundary=${responseBoundary}`, body)
  }

  /** Execute one `$batch` GET sub-request against the in-memory model and render
   * its HTTP/1.1 response section. */
  private executeBatchSubRequest(active: ActiveService, sub: { method: string; url: string }): string {
    if (sub.method.toUpperCase() !== 'GET') {
      return 'HTTP/1.1 501 Not Implemented\r\nContent-Type: application/json\r\n\r\n{"error":{"code":"501","message":"the mock serves read-only $batch sub-requests"}}'
    }
    const root = active.model.serviceRoot
    const pathname = stripQuery(sub.url)
    const rel = pathname.startsWith(root) ? pathname.slice(root.length) : pathname
    const query = parseQuery(sub.url)
    const segments = trimSlashes(rel).split('/')
    const head = segments[0] ?? ''
    const setMatch = /^([^(]+)(?:\(([^)]*)\))?$/.exec(head)
    const setName = setMatch?.[1] ?? ''
    const collection: ODataEntity[] | undefined = active.model.data[setName]
    if (!setMatch || collection === undefined) {
      return `HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n{"error":{"code":"404","message":"No entity set ${JSON.stringify(setName)}"}}`
    }
    const resolver = this.makeExpandResolver(active, active.model.entityTypeBySet.get(setName))
    const { value, count } = applyODataQuery(collection, parseSystemOptions(query), resolver)
    const body: Record<string, unknown> = { '@odata.context': `${root}/$metadata#${setName}`, value }
    if (count !== undefined) body['@odata.count'] = count
    const json = JSON.stringify(body)
    return `HTTP/1.1 200 OK\r\nContent-Type: ${ODATA_JSON_CONTENT_TYPE}\r\n\r\n${json}`
  }

  // ── response helpers ──────────────────────────────────────────────

  private writeJson(active: ActiveService, req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
    this.writeRaw(active, req, res, status, ODATA_JSON_CONTENT_TYPE, JSON.stringify(body))
  }

  private writeRaw(
    active: ActiveService,
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    contentType: string,
    body: string
  ): void {
    const headers: Record<string, string> = { 'Content-Type': contentType, 'OData-Version': '4.0' }
    if (!res.headersSent) res.writeHead(status, headers)
    res.end(body)
    this.recordServed(active, req, status, headers, body)
  }

  private recordServed(
    active: ActiveService,
    req: IncomingMessage,
    status: number,
    headers: Record<string, string>,
    body: string
  ): void {
    const served = (this.servedCounts.get(active.requestId) ?? 0) + 1
    this.servedCounts.set(active.requestId, served)
    this.broadcastServed(active.requestId, served)
    active.onServed?.({
      request: { method: req.method ?? '', url: req.url ?? '', headers: flattenIncomingHeaders(req.headers) },
      response: { status, headers, body }
    })
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('odata:request-progress', { requestId, status })
    }
  }

  private broadcastServed(requestId: string, count: number): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('odata:server-served', { requestId, count })
    }
  }
}

// ── module-private helpers ──────────────────────────────────────────

/** Split a service address (`localhost:<port><serviceRoot>`, optional scheme)
 * into its numeric port + service-root path. The root defaults to `/odata`. */
function parseServiceAddress(raw: string): { port: number; serviceRoot: string } {
  const stripped = raw.replace(/^[a-z]+:\/\//i, '')
  const slash = stripped.indexOf('/')
  const authority = slash >= 0 ? stripped.slice(0, slash) : stripped
  let serviceRoot = slash >= 0 ? stripped.slice(slash) : DEFAULT_ODATA_SERVICE_ROOT
  const q = serviceRoot.indexOf('?')
  if (q >= 0) serviceRoot = serviceRoot.slice(0, q)
  // Normalise: no trailing slash (so `/odata` prefix-matches `/odata/Pets`).
  serviceRoot = serviceRoot.replace(/\/+$/, '')
  if (serviceRoot === '') serviceRoot = DEFAULT_ODATA_SERVICE_ROOT
  const colon = authority.lastIndexOf(':')
  const port = colon >= 0 ? Number.parseInt(authority.slice(colon + 1), 10) : NaN
  return { port, serviceRoot }
}

/** Drop the query string from a URL, returning the pathname. */
function stripQuery(url: string): string {
  const q = url.indexOf('?')
  return q >= 0 ? url.slice(0, q) : url
}

/** Parse a URL's query string into a flat decoded map. */
function parseQuery(url: string): Record<string, string> {
  const q = url.indexOf('?')
  if (q < 0) return {}
  const out: Record<string, string> = {}
  for (const pair of url.slice(q + 1).split('&')) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    const key = eq >= 0 ? pair.slice(0, eq) : pair
    const value = eq >= 0 ? pair.slice(eq + 1) : ''
    out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '))
  }
  return out
}

/** Map the raw `$`-prefixed query params to the executor's parsed options. */
function parseSystemOptions(query: Record<string, string>): {
  filter?: string
  select?: string[]
  orderby?: string
  top?: number
  skip?: number
  count?: boolean
  expand?: string
} {
  const select = query['$select']
  return {
    ...(query['$filter'] !== undefined && { filter: query['$filter'] }),
    ...(select !== undefined && { select: select.split(',').map((s) => s.trim()).filter((s) => s !== '') }),
    ...(query['$orderby'] !== undefined && { orderby: query['$orderby'] }),
    ...(parsePagingValue(query['$top']) !== undefined && { top: parsePagingValue(query['$top']) }),
    ...(parsePagingValue(query['$skip']) !== undefined && { skip: parsePagingValue(query['$skip']) }),
    ...(query['$count'] === 'true' && { count: true }),
    ...(query['$expand'] !== undefined && { expand: query['$expand'] })
  }
}

/** Strip a leading/trailing slash from a path segment. */
function trimSlashes(s: string): string {
  return s.replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Strip the `Namespace.` prefix off a qualified type name. */
function stripNamespace(qualified: string): string {
  const dot = qualified.lastIndexOf('.')
  return dot >= 0 ? qualified.slice(dot + 1) : qualified
}

/** Unwrap `Collection(<Type>)` → `<Type>` (a to-many nav property's element
 * type); a non-collection type is returned unchanged. */
function unwrapCollectionType(type: string): string {
  const m = /^Collection\((.+)\)$/.exec(type.trim())
  return m ? m[1] : type
}

/** Read a request header value (case-insensitive), joining array values. */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()]
  return Array.isArray(v) ? v.join(', ') : v
}

/** Drain a request body to a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Parse an incoming `$batch` multipart/mixed body into its sub-requests
 * (method + URL only — v1 serves read-only batches). */
function parseBatchRequest(rawBody: string, boundary: string): { method: string; url: string }[] {
  const out: { method: string; url: string }[] = []
  const marker = `--${boundary}`
  for (const rawPart of rawBody.split(marker)) {
    const part = rawPart.trim()
    if (part === '' || part === '--') continue
    // The request line is the first line that looks like `GET <url> HTTP/1.1`.
    const requestLine = part.split(/\r?\n/).find((line) => /^(GET|POST|PUT|PATCH|DELETE)\s+\S+/i.test(line))
    if (!requestLine) continue
    const m = /^(\S+)\s+(\S+)/.exec(requestLine)
    if (m) out.push({ method: m[1].toUpperCase(), url: m[2] })
  }
  return out
}

/** A short random token for a batch-response boundary. */
function randomToken(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Flatten Node's `IncomingHttpHeaders` to a plain string map. */
function flattenIncomingHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

export const odataMockServerService = new ODataMockServerService()
export type { ServedSummary as ODataServedSummary }

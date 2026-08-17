/**
 * Design Server Service
 *
 * Serves a whole API design as a local HTTP service — the first server
 * projection of the designer. STATELESS v1: GET serves instances built
 * from the design's named examples (seeded faker beyond them), write
 * methods VALIDATE the inbound body against the model's constraints and
 * answer without changing state.
 *
 * Rides the shared HTTP/1.1 `PortHost` in
 * {@link import('./WebSocketExecutionService')} exactly like the OData
 * mock: ONE `*`-method prefix route claims the whole port and every
 * routing decision happens here, backed by the pure logic in
 * `shared/design/designServing.ts` (compiled table, auth presence
 * check, instance construction, pagination, body validation).
 *
 * Hot steering: while the server runs, the run modal can FORCE a
 * route's response (any status code, optional user-defined body) —
 * effective on the very next request, no restart. Design edits flow in
 * the same way via {@link updateDesign} (the renderer pushes the fresh
 * design on every autosave while serving).
 *
 * Dogfood: `/swagger.json` serves the design's own documentation as an
 * OpenAPI 3.0 document whose base URL is the served address — a served
 * API is self-described and therefore re-importable.
 *
 * Protocol projections: when `serving.protocols` enables them, the SAME
 * port also serves a GraphQL endpoint (`/graphql`, graphql-yoga over
 * the projected SDL + resolvers), a SOAP endpoint (`/soap`, `?wsdl`
 * for the generated contract) and an OData v4 service (`/odata`,
 * `$metadata` + entity sets) — all built on the same serving kernel,
 * all guarded by the design's default auth contract.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { BrowserWindow } from 'electron'
import { createSchema, createYoga, logger } from 'electron-core-ui/main'
import { websocketExecutionService } from './WebSocketExecutionService'
import type { ApiDesign, DesignModel, DesignProtocol } from '../../shared/types/apiDesign'
import { validateApiDesign } from '../../shared/design/validateApiDesign'
import { designToApiDocumentation } from '../../shared/design/apiDesignDoc'
import { apiDocumentationToOpenApi } from '../../shared/design/openApiExport'
import {
  authSatisfied,
  buildListPage,
  buildModelInstance,
  compileDesignRoutes,
  defaultResponseCode,
  effectiveAuth,
  matchDesignRoute,
  validateBodyAgainstModel,
  type CompiledRoute,
  type RouteMatch
} from '../../shared/design/designServing'
import { designGraphqlResolvers, designToGraphqlSdl } from '../../shared/design/graphqlProjection'
import {
  buildODataRows,
  designODataEntitySets,
  designToCsdl,
  matchODataEntity,
  type ODataEntitySet
} from '../../shared/design/odataProjection'
import { applyODataQuery, type ParsedODataQueryOptions } from '../../shared/utils/odataServerQuery'
import {
  buildSoapFaultEnvelope,
  buildSoapResponseEnvelope,
  designSoapOperations,
  designToWsdl,
  matchSoapOperation,
  type SoapOperation
} from '../../shared/design/soapProjection'

/** Default port a freshly-created design serves on (adjacent to the
 * HTTP mock's 8080 family, far from dev-server ranges). */
export const DEFAULT_DESIGN_SERVER_PORT = 4820

const JSON_CONTENT_TYPE = 'application/json'

/** A forced response steering one route (run-modal choice). */
export interface DesignForcedResponse {
  /** Status code to answer with, e.g. '502'. */
  code: string
  /** User-defined response body (served verbatim as JSON text).
   * Absent = the design's declared response for that code (example
   * instance when a model is bound, error envelope otherwise). */
  body?: string
}

/** Per-run call counters, broadcast after every served request. */
export interface DesignServerCounters {
  /** Total requests served this run (matched or not). */
  total: number
  /** routeId → total calls + per-status-code breakdown. */
  routes: Record<string, { total: number; byCode: Record<string, number> }>
}

interface ActiveServer {
  designId: string
  design: ApiDesign
  table: CompiledRoute[]
  port: number
  latencyMs: number
  /** routeId → forced response steering. */
  forced: Map<string, DesignForcedResponse>
  counters: DesignServerCounters
  /** Enabled protocol projections ('http' is always on). */
  protocols: Set<DesignProtocol>
  /** graphql-yoga handler, built when the projection is enabled. */
  yoga?: ReturnType<typeof createYoga>
  soapOperations?: SoapOperation[]
  odataSets?: ODataEntitySet[]
}

/** The URL prefixes the non-HTTP projections claim on the served port. */
const GRAPHQL_PATH = '/graphql'
const SOAP_PATH = '/soap'
const ODATA_ROOT = '/odata'

/** (Re)build the per-protocol serving artifacts from the design. */
function projectProtocols(active: ActiveServer): void {
  active.protocols = new Set<DesignProtocol>(['http', ...(active.design.serving?.protocols ?? [])])
  // Each projection is guarded INDIVIDUALLY: a projection that fails to
  // build logs + disables itself, the others (and HTTP) keep serving —
  // and the caller never sees a half-applied state.
  delete active.yoga
  if (active.protocols.has('graphql')) {
    try {
      active.yoga = createYoga({
        schema: createSchema({
          typeDefs: designToGraphqlSdl(active.design),
          resolvers: designGraphqlResolvers(active.design)
        }),
        graphqlEndpoint: GRAPHQL_PATH,
        landingPage: false,
        logging: {
          debug: () => { /* dropped */ },
          info: () => { /* dropped */ },
          warn: (...args: unknown[]) => { logger.warn('[DesignServerService] graphql', { args }) },
          error: (...args: unknown[]) => { logger.error('[DesignServerService] graphql', { args }) }
        }
      })
    } catch (err) {
      logger.error('[DesignServerService] graphql projection failed to build — disabled for this run', {
        designId: active.designId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
  try {
    if (active.protocols.has('soap')) active.soapOperations = designSoapOperations(active.design)
    else delete active.soapOperations
  } catch (err) {
    delete active.soapOperations
    logger.error('[DesignServerService] soap projection failed to build — disabled for this run', {
      designId: active.designId,
      error: err instanceof Error ? err.message : String(err)
    })
  }
  try {
    if (active.protocols.has('odata')) active.odataSets = designODataEntitySets(active.design)
    else delete active.odataSets
  } catch (err) {
    delete active.odataSets
    logger.error('[DesignServerService] odata projection failed to build — disabled for this run', {
      designId: active.designId,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/** Route key on the shared PortHost — namespaced so a design never
 * collides with a listening request's id. */
function hostKey(designId: string): string {
  return `design-server:${designId}`
}

class DesignServerService {
  /** Live servers, keyed by design id (one server per design). */
  private servers = new Map<string, ActiveServer>()

  /**
   * Spin the design's server. Refuses a design with validation issues
   * (the engine-side half of AC#8 — the UI disables the button too)
   * and surfaces a port conflict as a clean error.
   */
  async start(design: ApiDesign): Promise<{ success: boolean; listening: boolean; port: number; error?: string }> {
    const port = design.serving?.port ?? DEFAULT_DESIGN_SERVER_PORT
    if (this.servers.has(design.id)) {
      return { success: true, listening: true, port: this.servers.get(design.id)?.port ?? port }
    }
    const issues = validateApiDesign(design)
    if (issues.length > 0) {
      return { success: false, listening: false, port, error: `design has ${issues.length} validation issue(s)` }
    }

    const active: ActiveServer = {
      designId: design.id,
      design,
      table: compileDesignRoutes(design),
      port,
      latencyMs: design.serving?.latencyMs ?? 0,
      forced: new Map(),
      counters: { total: 0, routes: {} },
      protocols: new Set(['http'])
    }
    projectProtocols(active)

    // `started` is broadcast only once the bind is CONFIRMED (below) —
    // firing it optimistically flips the UI to "serving" for a split
    // second on a busy port (the beam lights, the run panel opens, then
    // everything cuts out). Same rule as HTTPExecutionService. The
    // request handler closes over `active` directly, so a request
    // landing before the map insert still dispatches.
    const result = await websocketExecutionService.listenHttpServer({
      requestId: hostKey(design.id),
      method: '*',
      port,
      path: '/',
      matchPrefix: true,
      onRequest: (req, res) => { void this.serve(active, req, res) },
      onStopped: (error) => {
        this.servers.delete(design.id)
        this.broadcastProgress(design.id, error ? 'error' : 'completed')
      }
    })
    if (!result.listening) {
      // Never announced as started — no progress event to walk back.
      return { success: false, listening: false, port, error: result.error ?? `failed to bind port ${port}` }
    }
    this.servers.set(design.id, active)
    this.broadcastProgress(design.id, 'started')
    logger.info('[DesignServerService] design server listening', { designId: design.id, port, routes: active.table.length })
    return { success: true, listening: true, port }
  }

  /** Stop the design's server, freeing the port. Idempotent. */
  stop(designId: string): boolean {
    if (!this.servers.has(designId)) return false
    this.servers.delete(designId)
    return websocketExecutionService.disconnect(hostKey(designId))
  }

  isListening(designId: string): boolean {
    return this.servers.has(designId)
  }

  status(designId: string): { listening: boolean; port?: number; counters?: DesignServerCounters } {
    const active = this.servers.get(designId)
    if (active === undefined) return { listening: false }
    return { listening: true, port: active.port, counters: active.counters }
  }

  /** Hot-steer one route's response (run modal). `null` clears the
   * override; effective on the next request, no restart. */
  setForced(designId: string, routeId: string, forced: DesignForcedResponse | null): boolean {
    const active = this.servers.get(designId)
    if (active === undefined) return false
    if (forced === null) active.forced.delete(routeId)
    else active.forced.set(routeId, forced)
    return true
  }

  /**
   * Swap in a fresh copy of the design while serving (autosave push).
   * The route table recompiles; the port and the run's counters stay.
   * A design that became invalid keeps serving its LAST VALID shape —
   * the spin gate only applies at start.
   */
  updateDesign(design: ApiDesign): boolean {
    const active = this.servers.get(design.id)
    if (active === undefined) return false
    if (validateApiDesign(design).length > 0) return false
    active.design = design
    active.table = compileDesignRoutes(design)
    active.latencyMs = design.serving?.latencyMs ?? 0
    projectProtocols(active)
    return true
  }

  /** Tear down every design server (project close + app quit). */
  closeAll(): void {
    for (const designId of [...this.servers.keys()]) {
      this.stop(designId)
    }
  }

  // ── dispatch ──────────────────────────────────────────────────────

  private async serve(active: ActiveServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (active.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, active.latencyMs))
    }
    const method = (req.method ?? 'GET').toUpperCase()
    const url = req.url ?? '/'
    const pathname = stripQuery(url)
    const query = parseQuery(url)

    try {
      if (method === 'GET' && pathname === '/swagger.json') {
        this.writeJson(active, res, 200, {}, this.servedOpenApi(active))
        this.recordServed(active, 'swagger', '200')
        return
      }

      // Protocol projections claim their prefixes before the HTTP route
      // table — the design's default auth (PRESENCE, like every served
      // credential check) guards each projection as a whole.
      if (active.yoga !== undefined && pathname === GRAPHQL_PATH) {
        if (!this.projectionAuthorized(active, req, res, 'graphql')) return
        await active.yoga(req, res)
        this.recordServed(active, 'graphql', String(res.statusCode))
        return
      }
      if (active.odataSets !== undefined && (pathname === ODATA_ROOT || pathname.startsWith(`${ODATA_ROOT}/`))) {
        if (!this.projectionAuthorized(active, req, res, 'odata')) return
        this.serveOData(active, method, pathname, query, req.headers, res)
        return
      }
      if (active.soapOperations !== undefined && pathname === SOAP_PATH) {
        if (!this.projectionAuthorized(active, req, res, 'soap')) return
        await this.serveSoap(active, method, url, req, res)
        return
      }

      const match = matchDesignRoute(active.table, method, pathname)
      if (match === null) {
        this.writeJson(active, res, 404, {}, errorEnvelope('404', `No route matches ${method} ${pathname}`))
        this.recordServed(active, 'unmatched', '404')
        return
      }
      const routeId = match.entry.route.id

      // Auth: PRESENCE of the right credential shape, any value.
      const auth = effectiveAuth(active.design, match.entry.group, match.entry.route)
      if (!authSatisfied(auth, req.headers, active.design)) {
        this.writeJson(active, res, 401, {}, errorEnvelope('401', `This route requires ${auth} credentials`))
        this.recordServed(active, routeId, '401')
        return
      }

      // Hot steering: a forced response short-circuits everything else.
      const forced = active.forced.get(routeId)
      if (forced !== undefined) {
        this.serveForcedResponse(active, match, forced, query, res)
        return
      }

      // Inbound body validation (write methods with a bound body model).
      const bodyModelId = match.entry.route.design?.body?.modelId
      if (bodyModelId !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        const model = active.design.models.find((m) => m.id === bodyModelId)
        if (model !== undefined) {
          const raw = await readBody(req)
          const parsed = parseJsonBody(raw)
          const issues = parsed.ok
            ? validateBodyAgainstModel(active.design, model, parsed.value)
            : [{ property: '', code: 'notAnObject' as const, detail: 'body is not valid JSON' }]
          if (issues.length > 0) {
            const detail = issues
              .map((i) => `${i.property === '' ? 'body' : i.property}: ${i.detail ?? i.code}`)
              .join('; ')
            this.writeJson(active, res, 400, {}, errorEnvelope('400', 'Request body failed validation', detail))
            this.recordServed(active, routeId, '400')
            return
          }
        }
      }

      this.serveDeclaredResponse(active, match, defaultResponseCode(match.entry.route), query, res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.writeJson(active, res, 500, {}, errorEnvelope('500', message))
      this.recordServed(active, 'error', '500')
    }
  }

  /** A projection enforces the design's DEFAULT auth contract (route
   * overrides are HTTP-projection concepts). 401 + false when unmet. */
  private projectionAuthorized(active: ActiveServer, req: IncomingMessage, res: ServerResponse, label: string): boolean {
    const auth = active.design.defaultAuth ?? 'none'
    if (authSatisfied(auth, req.headers, active.design)) return true
    this.writeJson(active, res, 401, {}, errorEnvelope('401', `This service requires ${auth} credentials`))
    this.recordServed(active, label, '401')
    return false
  }

  // ── OData projection ──────────────────────────────────────────────

  /** `/odata` service document, `/odata/$metadata` CSDL, and the
   * entity sets (collection + by-key) with system query options. */
  private serveOData(
    active: ActiveServer,
    method: string,
    pathname: string,
    query: Record<string, string>,
    headers: IncomingMessage['headers'],
    res: ServerResponse
  ): void {
    const odataHeaders = { 'OData-Version': '4.0' }
    const base = `http://localhost:${active.port}${ODATA_ROOT}`
    const relative = pathname.slice(ODATA_ROOT.length).replace(/^\//, '')

    if (method !== 'GET') {
      this.writeJson(active, res, 405, odataHeaders, errorEnvelope('405', 'The OData projection is read-only (stateless v1)'))
      this.recordServed(active, 'odata', '405')
      return
    }
    if (relative === '') {
      const sets = active.odataSets ?? []
      this.writeJson(active, res, 200, odataHeaders, {
        '@odata.context': `${base}/$metadata`,
        value: sets.map((set) => ({ name: set.name, kind: 'EntitySet', url: set.name }))
      })
      this.recordServed(active, 'odata', '200')
      return
    }
    if (relative === '$metadata') {
      this.writeRaw(active, res, 200, { 'Content-Type': 'application/xml', ...odataHeaders }, designToCsdl(active.design))
      this.recordServed(active, 'odata:$metadata', '200')
      return
    }

    const addressed = /^([^(/]+)(?:\((.+)\))?$/.exec(relative)
    const set = addressed?.[1] !== undefined
      ? (active.odataSets ?? []).find((s) => s.name === addressed[1])
      : undefined
    if (addressed === null || set === undefined) {
      this.writeJson(active, res, 404, odataHeaders, errorEnvelope('404', `No entity set matches ${relative}`))
      this.recordServed(active, 'odata', '404')
      return
    }

    // The set's data is as protected as the routes serving its model:
    // when any route declares a non-none auth, one of those contracts
    // must be satisfied (the design default was already checked).
    if (set.auths.length > 0 && !set.auths.some((auth) => authSatisfied(auth, headers, active.design))) {
      this.writeJson(active, res, 401, odataHeaders, errorEnvelope('401', `This entity set requires ${set.auths.join(' or ')} credentials`))
      this.recordServed(active, `odata:${set.name}`, '401')
      return
    }
    const rows = buildODataRows(active.design, set.model)
    const key = addressed[2]
    if (key !== undefined) {
      const entity = matchODataEntity(active.design, set.model, rows, key)
      if (entity === undefined) {
        this.writeJson(active, res, 404, odataHeaders, errorEnvelope('404', `No ${set.typeName} with key ${key}`))
        this.recordServed(active, `odata:${set.name}`, '404')
        return
      }
      this.writeJson(active, res, 200, odataHeaders, {
        '@odata.context': `${base}/$metadata#${set.name}/$entity`,
        ...entity
      })
      this.recordServed(active, `odata:${set.name}`, '200')
      return
    }

    const options: ParsedODataQueryOptions = {
      ...(query['$filter'] !== undefined ? { filter: query['$filter'] } : {}),
      ...(query['$select'] !== undefined ? { select: query['$select'].split(',').map((s) => s.trim()) } : {}),
      ...(query['$orderby'] !== undefined ? { orderby: query['$orderby'] } : {}),
      ...(parsedNonNegative(query['$top']) !== undefined ? { top: parsedNonNegative(query['$top']) } : {}),
      ...(parsedNonNegative(query['$skip']) !== undefined ? { skip: parsedNonNegative(query['$skip']) } : {}),
      ...(query['$count'] === 'true' ? { count: true } : {})
    }
    const result = applyODataQuery(rows, options)
    this.writeJson(active, res, 200, odataHeaders, {
      '@odata.context': `${base}/$metadata#${set.name}`,
      ...(result.count !== undefined ? { '@odata.count': result.count } : {}),
      value: result.value
    })
    this.recordServed(active, `odata:${set.name}`, '200')
  }

  // ── SOAP projection ───────────────────────────────────────────────

  /** `GET /soap?wsdl` serves the generated WSDL; `POST /soap`
   * dispatches by SOAPAction / body root and answers the operation's
   * bound payload (fault on no match). */
  private async serveSoap(
    active: ActiveServer,
    method: string,
    url: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const xmlHeaders = { 'Content-Type': 'text/xml; charset=utf-8' }
    const operations = active.soapOperations ?? []
    if (method === 'GET') {
      const address = `http://localhost:${active.port}${SOAP_PATH}`
      this.writeRaw(active, res, 200, xmlHeaders, designToWsdl(active.design, address))
      this.recordServed(active, 'soap:wsdl', '200')
      return
    }
    if (method !== 'POST') {
      this.writeRaw(active, res, 405, xmlHeaders, buildSoapFaultEnvelope('SOAP calls are POSTed'))
      this.recordServed(active, 'soap', '405')
      return
    }
    const body = await readBody(req)
    const action = req.headers['soapaction']
    const operation = matchSoapOperation(
      operations,
      Array.isArray(action) ? action[0] : action,
      soapBodyRootName(body)
    )
    if (operation === undefined) {
      this.writeRaw(active, res, 500, xmlHeaders, buildSoapFaultEnvelope('No operation matches this call'))
      this.recordServed(active, 'soap', '500')
      return
    }
    // The route's EFFECTIVE auth applies — same contract as HTTP.
    const auth = effectiveAuth(active.design, operation.group, operation.route)
    if (!authSatisfied(auth, req.headers, active.design)) {
      this.writeRaw(active, res, 401, xmlHeaders, buildSoapFaultEnvelope(`This operation requires ${auth} credentials`))
      this.recordServed(active, operation.route.id, '401')
      return
    }
    this.writeRaw(active, res, 200, xmlHeaders, buildSoapResponseEnvelope(active.design, operation))
    // SOAP operations map 1:1 to design routes — count under the route
    // id so the run modal's per-route dashboard sees this traffic.
    this.recordServed(active, operation.route.id, '200')
  }

  /** Serve the run-modal's forced choice: user body verbatim when
   * defined, the declared response for that code otherwise. */
  private serveForcedResponse(
    active: ActiveServer,
    match: RouteMatch,
    forced: DesignForcedResponse,
    query: Record<string, string>,
    res: ServerResponse
  ): void {
    const status = parseStatus(forced.code)
    if (forced.body !== undefined) {
      this.writeRaw(active, res, status, { 'Content-Type': JSON_CONTENT_TYPE }, forced.body)
      this.recordServed(active, match.entry.route.id, forced.code)
      return
    }
    this.serveDeclaredResponse(active, match, forced.code, query, res)
  }

  /** Serve the design's declared response for a status code: the bound
   * model's instance/page when the design binds one, the doc'd error
   * envelope otherwise. */
  private serveDeclaredResponse(
    active: ActiveServer,
    match: RouteMatch,
    code: string,
    query: Record<string, string>,
    res: ServerResponse
  ): void {
    const { route } = match.entry
    const status = parseStatus(code)
    const meta = route.design?.responses?.[code]
    const model = meta?.modelId !== undefined
      ? active.design.models.find((m) => m.id === meta.modelId)
      : undefined

    if (meta === undefined || model === undefined) {
      // No bound model. 2xx → empty success body; else an error
      // envelope carrying the documented description.
      const description = route.doc.responses?.[code]?.description
      const body = status < 400
        ? {}
        : errorEnvelope(code, description ?? `Served ${code} response`)
      this.writeJson(active, res, status, this.cacheHeaders(route.design?.cacheSeconds), body)
      this.recordServed(active, route.id, code)
      return
    }

    const headers = this.cacheHeaders(route.design?.cacheSeconds)
    if (meta.list === true) {
      const page = buildListPage(active.design, model, route, query)
      const body: unknown = meta.paginated === true ? page : page.items
      this.writeJson(active, res, status, headers, body)
      this.recordServed(active, route.id, code)
      return
    }

    const instance = this.serveSingleInstance(active, match, model, meta.exampleId)
    this.writeJson(active, res, status, headers, instance)
    this.recordServed(active, route.id, code)
  }

  /**
   * One served instance. A path parameter linked to the model's
   * identifier picks the NAMED example whose identifier value matches
   * (GET /users/{{id}} with a known example id → that example); the
   * bound `exampleId`, then the first named example, then a seeded
   * instance keyed by the captured path value keep it deterministic.
   */
  private serveSingleInstance(
    active: ActiveServer,
    match: RouteMatch,
    model: DesignModel,
    boundExampleId: string | undefined
  ): Record<string, unknown> {
    const seedKey = Object.values(match.params).join('/') || 'single'
    const examples = model.examples ?? []
    // Match a captured path value against each named example's served
    // identifier — the "GET /res/{id} → the corresponding named
    // example" contract.
    const identifierPropertyId = model.design?.identifier?.propertyId
    if (identifierPropertyId !== undefined) {
      for (const example of examples) {
        const instance = buildModelInstance(active.design, model, { exampleId: example.id, seedKey })
        const identifierProperty = model.properties.find((p) => p.id === identifierPropertyId)
        const name = identifierProperty?.doc.name
        if (name !== undefined && Object.values(match.params).some((v) => String(instance[name]) === v)) {
          return instance
        }
      }
    }
    const exampleId = boundExampleId ?? examples[0]?.id
    return exampleId !== undefined
      ? buildModelInstance(active.design, model, { exampleId, seedKey })
      : buildModelInstance(active.design, model, { seedKey })
  }

  /** The design's documentation as an OpenAPI doc whose base URL is
   * the SERVED address (the design's declared base path survives — it
   * is part of the served paths too). */
  private servedOpenApi(active: ActiveServer): Record<string, unknown> {
    const doc = designToApiDocumentation(active.design)
    doc.server = {
      host: `localhost:${active.port}`,
      schemes: ['http'],
      ...(active.design.server?.basePath !== undefined ? { basePath: active.design.server.basePath } : {})
    }
    return apiDocumentationToOpenApi(doc)
  }

  private cacheHeaders(cacheSeconds: number | undefined): Record<string, string> {
    return typeof cacheSeconds === 'number' && cacheSeconds > 0
      ? { 'Cache-Control': `max-age=${cacheSeconds}` }
      : {}
  }

  // ── response + telemetry helpers ──────────────────────────────────

  private writeJson(
    active: ActiveServer,
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: unknown
  ): void {
    this.writeRaw(active, res, status, { 'Content-Type': JSON_CONTENT_TYPE, ...headers }, JSON.stringify(body))
  }

  private writeRaw(
    _active: ActiveServer,
    res: ServerResponse,
    status: number,
    headers: Record<string, string>,
    body: string
  ): void {
    if (!res.headersSent) res.writeHead(status, headers)
    res.end(body)
  }

  private recordServed(active: ActiveServer, routeId: string, code: string): void {
    active.counters.total += 1
    const route = active.counters.routes[routeId] ?? { total: 0, byCode: {} }
    route.total += 1
    route.byCode[code] = (route.byCode[code] ?? 0) + 1
    active.counters.routes[routeId] = route
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('design-server:served', {
        designId: active.designId,
        routeId,
        code,
        counters: active.counters
      })
    }
  }

  private broadcastProgress(designId: string, status: 'started' | 'completed' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('design-server:progress', { designId, status })
    }
  }
}

// ── module-private helpers ──────────────────────────────────────────

/** The standard error envelope every non-2xx unbodied response uses —
 * same shape as the design generators' `Error` model. */
function errorEnvelope(code: string, message: string, details?: string): Record<string, unknown> {
  return { code, message, ...(details !== undefined ? { details } : {}) }
}

/** Parse a non-negative integer query value (`$top`/`$skip`). */
function parsedNonNegative(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** The local name of the first element inside the SOAP `<Body>`. */
function soapBodyRootName(xml: string): string | undefined {
  const body = /<(?:\w+:)?Body[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/i.exec(xml)
  const scope = body?.[1] ?? xml
  const root = /<\s*([\w:.-]+)[\s>/]/.exec(scope)
  return root?.[1]
}

/** Parse a forced/declared status-code string, defaulting to 200. */
function parseStatus(code: string): number {
  const parsed = Number.parseInt(code, 10)
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? parsed : 200
}

function stripQuery(url: string): string {
  const q = url.indexOf('?')
  return q >= 0 ? url.slice(0, q) : url
}

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

/** Drain a request body to a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

function parseJsonBody(raw: string): { ok: true; value: unknown } | { ok: false } {
  if (raw.trim() === '') return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

export const designServerService = new DesignServerService()

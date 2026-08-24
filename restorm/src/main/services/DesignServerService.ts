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
 * Dogfood: `{basePath}/swagger.json` (e.g. `/api/v1/swagger.json`, like a
 * classic API — with `/swagger.json` kept as a root discovery alias) serves
 * the design's own documentation as an OpenAPI 3.0 document whose base URL is
 * the served address — a served API is self-described and re-importable.
 *
 * Protocol projections: when `serving.protocols` enables them, the SAME
 * port also serves a GraphQL endpoint (`/graphql`, graphql-yoga over
 * the projected SDL + resolvers), a SOAP endpoint (`/soap`, `?wsdl`
 * for the generated contract) and an OData v4 service (`/odata`,
 * `$metadata` + entity sets) — all built on the same serving kernel,
 * all guarded by the design's default auth contract.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BrowserWindow } from 'electron'
import * as grpc from '@grpc/grpc-js'
import { createSchema, createYoga, logger } from 'electron-core-ui/main'
import { websocketExecutionService } from './WebSocketExecutionService'
import type { ApiDesign, DesignModel, DesignProtocol } from '../../shared/types/apiDesign'
import { validateApiDesign } from '../../shared/design/validateApiDesign'
import { composeRoutePath, designToApiDocumentation } from '../../shared/design/apiDesignDoc'
import { apiDocumentationToOpenApi } from '../../shared/design/openApiExport'
import {
  authSatisfied,
  buildListPage,
  resolvePageWindow,
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
import { DesignStatefulStore, identifierName, identifierProperty } from '../../shared/design/designStateful'
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
import {
  buildGrpcResponse,
  designGrpcMethods,
  designProtoPackage,
  designProtoServiceName,
  designToProto,
  type GrpcMethod
} from '../../shared/design/grpcProjection'

/** Default port a freshly-created design serves on (adjacent to the
 * HTTP mock's 8080 family, far from dev-server ranges). */
export const DEFAULT_DESIGN_SERVER_PORT = 4820

/** Default port the gRPC projection's separate HTTP/2 server binds —
 * adjacent to the HTTP default so a design's two servers stay grouped. */
export const DEFAULT_DESIGN_GRPC_PORT = 4821

/** Grace window for a graceful gRPC shutdown to drain in-flight calls
 * before the server is force-stopped (ms). */
const GRPC_SHUTDOWN_GRACE_MS = 2000

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
  /** The gRPC projection's separate HTTP/2 server, present only while
   * 'grpc' is enabled and its bind succeeded. */
  grpcServer?: grpc.Server
  /** The port the gRPC server actually bound. */
  grpcPort?: number
  /** The `.proto` text the live gRPC server was built from — lets an
   * autosave skip a rebuild when the projected proto is unchanged. */
  grpcProto?: string
  /** Serializes gRPC (re)builds so overlapping autosaves never race the
   * bind against a previous server's graceful shutdown (EADDRINUSE). */
  grpcSync?: Promise<void>
  /** Ephemeral store, present only while the design serves STATEFUL. */
  store?: DesignStatefulStore
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
    // The renderer resolves a `{{variable}}` port to a number before serving,
    // but a design served straight from disk or MCP may still carry a string
    // (a literal "8080" or an unresolved expression) — coerce, falling back
    // to the default when it isn't a usable port number.
    const rawPort = design.serving?.port
    const parsedPort = typeof rawPort === 'number' ? rawPort : typeof rawPort === 'string' ? Number.parseInt(rawPort, 10) : NaN
    const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_DESIGN_SERVER_PORT
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
    if (design.serving?.stateful === true) active.store = new DesignStatefulStore(design)

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
    // The gRPC projection binds its OWN HTTP/2 port. Like the other
    // projections it self-disables on failure (logged) rather than
    // failing the whole spin — HTTP keeps serving regardless.
    await this.syncGrpcProjection(active)
    this.broadcastProgress(design.id, 'started')
    logger.info('[DesignServerService] design server listening', { designId: design.id, port, routes: active.table.length })
    return { success: true, listening: true, port }
  }

  /** Stop the design's server, freeing the port. Idempotent. */
  stop(designId: string): boolean {
    const active = this.servers.get(designId)
    if (active === undefined) return false
    this.servers.delete(designId)
    // Free the separate gRPC port too (best-effort, graceful).
    void this.teardownGrpc(active)
    return websocketExecutionService.disconnect(hostKey(designId))
  }

  isListening(designId: string): boolean {
    return this.servers.has(designId)
  }

  status(designId: string): { listening: boolean; port?: number; grpcPort?: number; counters?: DesignServerCounters } {
    const active = this.servers.get(designId)
    if (active === undefined) return { listening: false }
    return {
      listening: true,
      port: active.port,
      ...(active.grpcPort !== undefined ? { grpcPort: active.grpcPort } : {}),
      counters: active.counters
    }
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
    // Rebuild / tear down the gRPC server to match the fresh design.
    // Fire-and-forget: the renderer's autosave push doesn't await the
    // (async) HTTP/2 rebind, and a failure self-disables like the others.
    void this.syncGrpcProjection(active)
    // Stateful store lifecycle: SEED only on a stateless→stateful
    // transition (or the very first start). A live design edit while
    // serving must NOT wipe the accumulated rows — it only retargets the
    // shape used by future operations; the store resets solely on a
    // server restart (a fresh ActiveServer). Toggled OFF drops it.
    if (design.serving?.stateful === true) {
      if (active.store === undefined) active.store = new DesignStatefulStore(design)
      else active.store.retarget(design)
    } else {
      delete active.store
    }
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
      // The descriptor lives UNDER the design base path — like a classic
      // API (`/api/v1/swagger.json`), consistent with where the routes are
      // served. The bare root path stays a discovery alias; with no base
      // path the two collapse to the same `/swagger.json`.
      const swaggerUnderBase = composeRoutePath({ designBasePath: active.design.server?.basePath }, 'swagger.json')
      if (method === 'GET' && (pathname === swaggerUnderBase || pathname === '/swagger.json')) {
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

      // Read the inbound body for write methods — the stateful store
      // needs the client payload EVEN WHEN no body model is declared (a
      // common hand-authored POST/PATCH shape), so the body is not gated
      // on `body.modelId`. When a body model IS bound, validate first.
      let writeBody: Record<string, unknown> = {}
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const raw = await readBody(req)
        const parsed = parseJsonBody(raw)
        const bodyModelId = match.entry.route.design?.body?.modelId
        const bodyModel = bodyModelId !== undefined
          ? active.design.models.find((m) => m.id === bodyModelId)
          : undefined
        if (bodyModel !== undefined) {
          const issues = parsed.ok
            ? validateBodyAgainstModel(active.design, bodyModel, parsed.value)
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
        if (parsed.ok && isRecord(parsed.value)) writeBody = parsed.value
      }

      // Stateful dispatch: writes carry their parsed body, reads pass {}.
      // Forced responses already short-circuited above, so hot steering
      // keeps priority over the state (AC#4).
      if (active.store !== undefined && this.serveStateful(active, match, method, query, writeBody, res)) {
        return
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

  // ── gRPC projection (separate HTTP/2 server) ──────────────────────

  /**
   * Bring the gRPC projection in line with the current design: bind an
   * `@grpc/grpc-js` server on the design's gRPC port when 'grpc' is
   * enabled, tear it down when it isn't, and skip a rebuild when the
   * projected `.proto` is byte-identical to the live one (a no-op
   * autosave must not churn the port). Failures self-disable (logged) —
   * the HTTP server and the other projections are unaffected.
   */
  private syncGrpcProjection(active: ActiveServer): Promise<void> {
    // Chain onto the previous sync so a rebuild never binds while the
    // prior server is still inside its graceful shutdown (EADDRINUSE).
    const next = (active.grpcSync ?? Promise.resolve()).then(() => this.runGrpcSync(active))
    active.grpcSync = next.catch(() => undefined)
    return next
  }

  private async runGrpcSync(active: ActiveServer): Promise<void> {
    // The design may have been stopped while this sync was queued.
    if (!this.servers.has(active.designId)) {
      await this.teardownGrpc(active)
      return
    }
    if (!active.protocols.has('grpc')) {
      await this.teardownGrpc(active)
      return
    }
    let proto: string
    try {
      proto = designToProto(active.design)
    } catch (err) {
      await this.teardownGrpc(active)
      logger.error('[DesignServerService] grpc projection failed to build — disabled for this run', {
        designId: active.designId,
        error: err instanceof Error ? err.message : String(err)
      })
      return
    }
    if (active.grpcServer !== undefined && active.grpcProto === proto) return
    await this.teardownGrpc(active)
    try {
      await this.bringUpGrpc(active, proto)
      // Stopped mid-bring-up? Tear the just-bound server back down so the
      // port never leaks past a stop() that raced this rebuild.
      if (!this.servers.has(active.designId)) await this.teardownGrpc(active)
    } catch (err) {
      logger.error('[DesignServerService] grpc projection failed to bind — disabled for this run', {
        designId: active.designId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  /** Load the projected proto, register one unary handler per route, add
   * reflection, and bind the HTTP/2 port. */
  private async bringUpGrpc(active: ActiveServer, proto: string): Promise<void> {
    const port = active.design.serving?.grpcPort ?? DEFAULT_DESIGN_GRPC_PORT
    const methods = designGrpcMethods(active.design)
    const file = materialiseProtoText(proto)
    const protoLoader = await import('@grpc/proto-loader')
    const pkgDef = protoLoader.loadSync(file, {
      keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: []
    })
    // `loadSync` read the file into `pkgDef`; nothing needs it afterwards
    // (reflection works off `pkgDef`), so drop the temp dir immediately
    // rather than leaking one per proto-changing rebuild.
    try { rmSync(dirname(file), { recursive: true, force: true }) } catch { /* best-effort */ }
    const root = grpc.loadPackageDefinition(pkgDef)
    const service = resolveGrpcService(root, designProtoPackage(active.design), designProtoServiceName(active.design))
    if (service === undefined) {
      throw new Error('the projected proto exposes no service')
    }
    const server = new grpc.Server()
    server.addService(service, this.buildGrpcHandlers(active, methods))
    // Server reflection (best-effort): a client can call without the
    // `.proto`. Loaded lazily so a failure never fails the bind.
    try {
      const { ReflectionService } = await import('@grpc/reflection')
      new ReflectionService(pkgDef).addToServer(server)
    } catch (err) {
      logger.warn('[DesignServerService] grpc reflection unavailable', {
        designId: active.designId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
    const boundPort = await new Promise<number>((resolve, reject) => {
      server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (err, p) => {
        if (err) { reject(err); return }
        resolve(p)
      })
    })
    active.grpcServer = server
    active.grpcPort = boundPort
    active.grpcProto = proto
    logger.info('[DesignServerService] design grpc projection listening', {
      designId: active.designId, port: boundPort, methods: methods.length
    })
  }

  /** Gracefully stop the gRPC server (force-fallback), freeing its port. */
  private async teardownGrpc(active: ActiveServer): Promise<void> {
    const server = active.grpcServer
    delete active.grpcServer
    delete active.grpcPort
    delete active.grpcProto
    if (server === undefined) return
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(() => {
        try { server.forceShutdown() } catch { /* already down */ }
        resolve()
      }, GRPC_SHUTDOWN_GRACE_MS)
      try {
        server.tryShutdown(() => { clearTimeout(fallback); resolve() })
      } catch {
        clearTimeout(fallback)
        try { server.forceShutdown() } catch { /* already down */ }
        resolve()
      }
    })
  }

  /** One unary handler per route; each answers via the shared serving
   * kernel and enforces the design's DEFAULT auth (presence) via call
   * metadata, exactly like the other projections. */
  private buildGrpcHandlers(active: ActiveServer, methods: GrpcMethod[]): grpc.UntypedServiceImplementation {
    const handlers: grpc.UntypedServiceImplementation = {}
    for (const method of methods) {
      handlers[method.name] = this.grpcUnaryHandler(active, method)
    }
    return handlers
  }

  private grpcUnaryHandler(active: ActiveServer, method: GrpcMethod): grpc.handleUnaryCall<object, object> {
    return (call, callback) => {
      const auth = active.design.defaultAuth ?? 'none'
      if (!authSatisfied(auth, grpcMetadataToHeaders(call.metadata), active.design)) {
        this.recordServed(active, method.route.id, '401')
        const message = `This service requires ${auth} credentials`
        callback({ name: 'DesignServerGrpc', message, code: grpc.status.UNAUTHENTICATED, details: message }, null)
        return
      }
      try {
        const response = buildGrpcResponse(active.design, method, isRecord(call.request) ? call.request : {})
        callback(null, response)
        this.recordServed(active, method.route.id, '200')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.recordServed(active, method.route.id, '500')
        callback({ name: 'DesignServerGrpc', message, code: grpc.status.INTERNAL, details: message }, null)
      }
    }
  }

  /**
   * Stateful dispatch: run the matched route against the ephemeral
   * store. Returns true when it handled the request; false to fall back
   * to the stateless declared response (a route the store can't map —
   * no bound model, or a GET on a model with no identifier for a
   * by-id path). The store was already seeded from the named examples.
   */
  private serveStateful(
    active: ActiveServer,
    match: RouteMatch,
    method: string,
    query: Record<string, string>,
    body: unknown,
    res: ServerResponse
  ): boolean {
    const store = active.store
    if (store === undefined) return false
    const { route } = match.entry
    const responseMeta = route.design?.responses
    const successCode = defaultResponseCode(route)
    const successMeta = responseMeta?.[successCode]
    const responseModel = successMeta?.modelId !== undefined
      ? active.design.models.find((m) => m.id === successMeta.modelId)
      : undefined
    const bodyModel = route.design?.body?.modelId !== undefined
      ? active.design.models.find((m) => m.id === route.design?.body?.modelId)
      : undefined
    // Resolve the resource model + the id VALUE from the route's
    // paramLinks (the authoritative binding of a path param to a model's
    // identifier property), never from positional guessing.
    const { model: resourceModel, idValue } = this.resolveStatefulResource(active, route, match, responseModel, bodyModel)
    const headers = this.cacheHeaders(route.design?.cacheSeconds)

    if (method === 'GET') {
      if (resourceModel === undefined) return false
      if (successMeta?.list === true) {
        // Same clamp + envelope as the stateless list, so the toggle
        // never changes the shape (limit/offset honoured, maxLimit capped).
        const { limit, offset } = resolvePageWindow(route, query)
        const page = store.list(resourceModel, { limit, offset })
        const envelope = { items: page.items, total: page.total, limit, offset }
        const payload: unknown = successMeta.paginated === true ? envelope : page.items
        this.writeJson(active, res, parseStatus(successCode), headers, payload)
        this.recordServed(active, route.id, successCode)
        return true
      }
      if (idValue === undefined) return false
      const row = store.get(resourceModel, idValue)
      if (row === undefined) {
        this.writeJson(active, res, 404, {}, errorEnvelope('404', `No ${resourceModel.doc.name} with id ${idValue}`))
        this.recordServed(active, route.id, '404')
        return true
      }
      this.writeJson(active, res, parseStatus(successCode), headers, row)
      this.recordServed(active, route.id, successCode)
      return true
    }

    if (method === 'POST') {
      const model = bodyModel ?? responseModel ?? resourceModel
      if (model === undefined) return false
      const created = store.create(model, isRecord(body) ? body : {})
      this.writeJson(active, res, parseStatus(successCode), headers, created)
      this.recordServed(active, route.id, successCode)
      return true
    }

    if (method === 'PUT' || method === 'PATCH') {
      if (resourceModel === undefined || idValue === undefined) return false
      const updated = store.update(resourceModel, idValue, isRecord(body) ? body : {})
      if (updated === undefined) {
        this.writeJson(active, res, 404, {}, errorEnvelope('404', `No ${resourceModel.doc.name} with id ${idValue}`))
        this.recordServed(active, route.id, '404')
        return true
      }
      this.writeJson(active, res, parseStatus(successCode), headers, updated)
      this.recordServed(active, route.id, successCode)
      return true
    }

    if (method === 'DELETE') {
      if (resourceModel === undefined || idValue === undefined || identifierName(resourceModel) === undefined) return false
      // Capture the row before removal for a body-returning success code.
      const removedRow = store.get(resourceModel, idValue)
      const outcome = store.remove(resourceModel, idValue)
      if (outcome === 'not-found') {
        this.writeJson(active, res, 404, {}, errorEnvelope('404', `No ${resourceModel.doc.name} with id ${idValue}`))
        this.recordServed(active, route.id, '404')
        return true
      }
      if (outcome === 'restricted') {
        this.writeJson(active, res, 409, {}, errorEnvelope('409', `Cannot delete ${resourceModel.doc.name} ${idValue}: another record still references it`))
        this.recordServed(active, route.id, '409')
        return true
      }
      // Honour the route's DECLARED success code: 204 → empty, otherwise
      // return the removed row (a 200 delete with an empty body is what
      // no client expects).
      if (parseStatus(successCode) === 204) {
        this.writeRaw(active, res, 204, {}, '')
      } else {
        this.writeJson(active, res, parseStatus(successCode), headers, removedRow ?? {})
      }
      this.recordServed(active, route.id, successCode)
      return true
    }

    return false
  }

  /**
   * The resource model a stateful route operates on, and the id VALUE for
   * a by-id operation, resolved from the route's paramLinks. The route's
   * own response/body model is the resource; the id param is the one whose
   * link targets THAT model's identifier property (so a nested
   * `/users/{userId}/orders/{orderId}` addresses the Order, not the User).
   * A bodyless route with no response/body model (a DELETE returning 204)
   * takes the resource from the DEEPEST path param that links a model's
   * identifier. Returns an undefined model/id when nothing links — the
   * caller then falls through to the stateless declared response.
   */
  private resolveStatefulResource(
    active: ActiveServer,
    route: RouteMatch['entry']['route'],
    match: RouteMatch,
    responseModel: DesignModel | undefined,
    bodyModel: DesignModel | undefined
  ): { model: DesignModel | undefined; idValue: string | undefined } {
    const links = route.design?.paramLinks ?? {}
    let model = responseModel ?? bodyModel
    let idValue: string | undefined
    if (model !== undefined) {
      // Only an id param linked to the resource's OWN identifier sets the
      // id — a model without an identifier leaves idValue undefined so the
      // by-id branches fall through to the stateless response (as the
      // docstring promises), rather than 404-ing on a non-existent key.
      const idProp = identifierProperty(model)
      if (idProp !== undefined) {
        for (const [name, link] of Object.entries(links)) {
          if (link.modelId === model.id && link.propertyId === idProp.id) {
            idValue = match.params[name]
          }
        }
      }
    } else {
      // No own model — take the resource from the deepest identifier-linked
      // path param. Iterate TRUE path order (match.params), not paramLinks
      // key order, so the addressed (last) resource wins in a nested path.
      for (const name of Object.keys(match.params)) {
        const link = links[name]
        if (link === undefined) continue
        const candidate = active.design.models.find((m) => m.id === link.modelId)
        if (candidate === undefined) continue
        if (link.propertyId === identifierProperty(candidate)?.id) {
          model = candidate
          idValue = match.params[name]
        }
      }
    }
    return { model, idValue }
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

/** A plain JSON object (a validated request body reaching the store). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Write projected `.proto` text to a temp file the proto-loader reads. */
function materialiseProtoText(proto: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'restorm-design-grpc-'))
  const file = join(dir, 'design.proto')
  writeFileSync(file, proto, 'utf8')
  return file
}

/** Descend a (possibly dotted) package path to the named service's
 * definition; undefined when the loaded proto shapes it differently. */
function resolveGrpcService(
  root: grpc.GrpcObject,
  pkg: string,
  serviceName: string
): grpc.ServiceDefinition | undefined {
  let node: grpc.GrpcObject = root
  for (const segment of pkg.split('.')) {
    if (segment === '') continue
    const next: unknown = node[segment]
    if (next === undefined || typeof next === 'function') return undefined
    node = next as grpc.GrpcObject
  }
  const ctor: unknown = node[serviceName]
  if (typeof ctor !== 'function') return undefined
  return (ctor as grpc.ServiceClientConstructor).service
}

/** Flatten gRPC call metadata to an HTTP-headers-shaped map so the
 * shared auth-presence check treats a gRPC call like every other
 * projection (a `bearer`/`apiKey` credential arrives as call metadata). */
function grpcMetadataToHeaders(metadata: grpc.Metadata): IncomingMessage['headers'] {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata.getMap())) {
    headers[key.toLowerCase()] = typeof value === 'string' ? value : value.toString('utf8')
  }
  return headers
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

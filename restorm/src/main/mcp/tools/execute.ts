/**
 * Execution + history MCP tools — let an MCP client run a request and
 * read its response, plus query the response history. This is what
 * turns restorm into a real "agent troubleshoots an API" surface (you
 * can ask Claude to ping an endpoint and see the JSON come back).
 *
 * For unary protocols (HTTP / OData / GraphQL / SOAP / gRPC) `run_request`
 * delegates to the renderer's Send button so the response panel + URL
 * bar + history panel all update as if the user clicked Send. The
 * AI's view and the user's view stay aligned. Main waits for a new
 * history entry to land then reads it back as the structured result.
 *
 * For streaming protocols (WebSocket today; gRPC streaming follows when
 * the gRPC service grows real streaming support) `run_request` returns
 * the first frames + a `continuationToken`; subsequent reads via
 * `read_stream(token)` pull the next slice from the WS service's
 * message buffer without blocking the MCP channel.
 *
 * Auth resolution + secret masking happen inside the execution service
 * pipeline as usual; the response body comes back already-redacted
 * when the user has the "redact secrets in response history" toggle on
 * (default on).
 */

import { z } from 'zod'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { BrowserWindow } from 'electron'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { contextService } from '../../services/ContextService'
import type { FullRequestData } from '../../services/ContextServiceTypes'
import { responseHistoryService } from '../../services'
import { websocketExecutionService } from '../../services/WebSocketExecutionService'
import { PROTOCOL_EXECUTORS } from '../../protocol/executorRegistry'
import { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isODataRequest, isAuthenticationRequest, isWebSocketRequest, isSseRequest, isJsonRpcRequest, isJsonRpcBatchRequest, isTrpcRequest, isAmqpRequest, isRedisRequest, isEnvironmentFolder } from '../../../shared/types/collections'
import type { HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, SseRequest, AuthenticationRequest, ODataRequest, JsonRpcRequest, JsonRpcBatchRequest, TrpcRequest, AmqpRequest, RedisRequest, KeyValue, EnvironmentFolder } from '../../../shared/types/collections'
import { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isODataRequest, isAuthenticationRequest, isWebSocketRequest, isStompRequest, isEnvironmentFolder } from '../../../shared/types/collections'
import type { HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, StompRequest, AuthenticationRequest, ODataRequest, KeyValue, EnvironmentFolder } from '../../../shared/types/collections'
import { isRequest, type FolderItem, type Request } from '../../../shared/models'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Bodies larger than this threshold get spilled to a temp file and the
 * inline `body` field shrinks to a preview + path hint. The MCP harness
 * caps tool-result token counts; a single ~200 KiB response (e.g.
 * `/my/logs`) used to trip a generic spillover that drops the whole
 * structured result behind an opaque file read. Truncating *just the
 * body* preserves the typed fields (status, headers, durationMs, …) so
 * the caller can still branch on them without paying the round-trip.
 */
const BODY_TRUNCATION_THRESHOLD_BYTES = 50 * 1024
const BODY_INLINE_PREVIEW_BYTES = 4 * 1024

/**
 * Per-instance private directory for spilled response bodies. A
 * response body can carry secret-bearing data (tokens, PII), so it
 * must not land world-readable in the shared system temp dir.
 * `mkdtemp` creates the directory 0700; the files inside are written
 * 0600. Created lazily and memoised for the lifetime of the process.
 */
let spillDirPromise: Promise<string> | null = null
function getSpillDir(): Promise<string> {
  spillDirPromise ??= fs.promises.mkdtemp(path.join(os.tmpdir(), 'restorm-mcp-body-'))
  return spillDirPromise
}

async function maybeTruncateBody(shaped: unknown): Promise<unknown> {
  if (!shaped || typeof shaped !== 'object') return shaped
  const obj = shaped as Record<string, unknown> & { body?: unknown }
  if (obj.body === undefined || obj.body === null) return shaped
  const serialised = typeof obj.body === 'string'
    ? obj.body
    : JSON.stringify(obj.body)
  if (serialised.length <= BODY_TRUNCATION_THRESHOLD_BYTES) {
    // Make the negative answer explicit at the result root so callers
    // can branch on `result.bodyTruncated === false` without falling
    // back to `'bodyTruncated' in result` semantics.
    return { ...obj, bodyTruncated: false }
  }

  const requestId = typeof obj.requestId === 'string' ? obj.requestId : 'request'
  const safeId = requestId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  // Add a random suffix on top of `Date.now()` so two truncations of
  // the same requestId in the same millisecond (run_request_batch, racing
  // retries) don't clobber each other's spill files.
  const suffix = Math.random().toString(36).slice(2, 10)
  const fileName = `body-${safeId}-${Date.now()}-${suffix}.json`
  // Persist the body in its prettiest form: pretty-print JSON when we
  // had structured data, otherwise the raw string. The caller can
  // Read the file directly without re-parsing.
  const persisted = typeof obj.body === 'string'
    ? obj.body
    : JSON.stringify(obj.body, null, 2)
  let filePath = ''
  try {
    filePath = path.join(await getSpillDir(), fileName)
    await fs.promises.writeFile(filePath, persisted, { encoding: 'utf-8', mode: 0o600 })
  } catch (err) {
    // Persistence failed — keep the original body. The harness's own
    // spillover still has us covered; we just lose the structured
    // typed-fields-preserved nicety.
    return {
      ...obj,
      bodyTruncated: false,
      bodySpillError: err instanceof Error ? err.message : String(err)
    }
  }

  const previewSlice = serialised.slice(0, BODY_INLINE_PREVIEW_BYTES)
  const inlineBody = typeof obj.body === 'string'
    ? `${previewSlice}\n…<body truncated at ${BODY_INLINE_PREVIEW_BYTES} bytes; full ${serialised.length} bytes at ${filePath}>…`
    : {
        _truncated: true,
        _previewBytes: BODY_INLINE_PREVIEW_BYTES,
        _totalBytes: serialised.length,
        _filePath: filePath,
        _preview: previewSlice
      }

  return {
    ...obj,
    body: inlineBody,
    bodyTruncated: true,
    bodyTotalBytes: serialised.length,
    bodySpilledPath: filePath,
    bodySpilledHint: `Full response body written to ${filePath} (${serialised.length} bytes). Read it directly when the inline preview is insufficient.`
  }
}

/**
 * Project a raw history-detail entry into the run_request wire shape.
 * The history detail already contains everything the AI needs (status,
 * headers, body, timings, URL) — we just rename a few fields and parse
 * JSON bodies in-place so the caller doesn't get a string-of-JSON.
 *
 * Field mapping: history details follow the per-protocol shapes in
 * `responseHistory.ts` — bodies live under `responseBody` (HTTP/OData/SOAP)
 * or `data`/`errors` (GraphQL) or `responseMessage` (gRPC) or `messages`
 * (WebSocket); `responseHeaders` is an *array* of `{ key, value }` pairs,
 * not a flat object; `durationMs` is nested under `timings`.
 */
function pickHeaderValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return ''
  const lower = name.toLowerCase()
  for (const entry of headers as { key?: string; value?: string }[]) {
    if (typeof entry.key === 'string' && entry.key.toLowerCase() === lower) {
      return typeof entry.value === 'string' ? entry.value : ''
    }
  }
  return ''
}

function pickBody(response: Record<string, unknown>): { raw: unknown; isString: boolean } {
  // GraphQL: structured already
  if ('data' in response || 'errors' in response) {
    return { raw: { data: response['data'], errors: response['errors'] }, isString: false }
  }
  // gRPC
  if (typeof response['responseMessage'] === 'string') {
    return { raw: response['responseMessage'], isString: true }
  }
  // WebSocket
  if (Array.isArray(response['messages'])) {
    return { raw: response['messages'], isString: false }
  }
  // HTTP / OData / SOAP
  if (typeof response['responseBody'] === 'string') {
    return { raw: response['responseBody'], isString: true }
  }
  return { raw: undefined, isString: false }
}

function shapeHistoryDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== 'object') return detail
  const d = detail as Record<string, unknown>
  const response = (d['response'] ?? {}) as Record<string, unknown>

  const responseHeaders = response['responseHeaders']
  const contentType = typeof response['contentType'] === 'string'
    ? response['contentType']
    : pickHeaderValue(responseHeaders, 'content-type')

  const { raw, isString } = pickBody(response)
  let parsedBody: unknown = raw
  if (isString && typeof raw === 'string' && /application\/(json|.*\+json)/i.test(contentType)) {
    try { parsedBody = JSON.parse(raw) } catch { /* keep as string */ }
  }

  const timings = (response['timings'] ?? {}) as Record<string, unknown>
  const durationMs = typeof timings['durationMs'] === 'number'
    ? timings['durationMs']
    : typeof response['durationMs'] === 'number' ? response['durationMs'] : undefined

  // Echo the request data the renderer actually sent — so the caller
  // sees exactly what hit the wire, including handlebars-resolved URL,
  // path/query params, headers, and body. Field availability is
  // protocol-specific (e.g. GraphQL has no `requestParams`); the
  // consumer can ignore missing keys.
  //
  // gRPC overloads `requestMethod` on the history shape to mean "the
  // gRPC method name" — for every other protocol it's the HTTP verb.
  // We gate the grpc-specific extras on `protocol === 'grpc'` so an
  // HTTP response doesn't end up with a misleading `grpcMethod: "GET"`.
  const requestMeta = (d['requestMeta'] ?? {}) as Record<string, unknown>
  // Every history entry stamps its real `type` (http/grpc/websocket/…). If it
  // is ever missing, surface 'unknown' rather than silently claiming 'http' —
  // mislabelling a grpc/ws entry as http is worse than admitting we don't know.
  const protocol = response['type'] ?? 'unknown'
  const isGrpc = protocol === 'grpc'
  const sentRequest = {
    method: response['requestMethod'] ?? requestMeta['method'],
    url: response['requestUrl'],
    headers: response['requestHeaders'],
    params: response['requestParams'],
    pathParams: response['requestPathParams'],
    body: response['requestBody'],
    // protocol-specific extras
    ...(typeof response['requestSoapAction'] === 'string' ? { soapAction: response['requestSoapAction'] } : {}),
    ...(isGrpc ? {
      grpcMethod: response['requestMethod'],
      grpcMessage: response['requestMessage'],
      grpcMetadata: response['requestMetadata']
    } : {})
  }

  return {
    requestId: d['requestId'],
    protocol,
    success: d['success'] === true,
    status: response['statusCode'] ?? null,
    statusText: response['statusText'],
    headers: responseHeaders,
    body: parsedBody,
    bodyContentType: contentType || undefined,
    durationMs,
    requestUrl: response['requestUrl'],
    request: sentRequest,
    error: response['error']
  }
}

/**
 * Broadcast `mcp:run-request` to every renderer window. The matching
 * `useMcpRunRequest` hook clicks the request's Send button so the
 * normal renderer-side dispatch runs.
 */
function dispatchSendInRenderer(itemId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mcp:run-request', { itemId })
  }
}

function broadcastOpenTab(itemId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mcp:open-tab', { itemId, kind: 'request' as const })
  }
}

function waitForNewHistoryEntry(requestId: string, baselineGuid: string | null, timeoutMs: number): Promise<{ guid: string } | null> {
  // Event-driven: ResponseHistoryService wakes us when the new entry is stored,
  // so we don't busy-poll list() (disk/IPC) every 200ms for up to 120s.
  return responseHistoryService.waitForNewEntry(requestId, baselineGuid, timeoutMs)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Continuation token format for `read_stream`. We embed the next-frame
 * cursor + the request id into a single opaque string so the AI doesn't
 * need to track its own state. Plain text by design — there's nothing
 * sensitive in a cursor index.
 *
 * The cursor goes FIRST (it is always a `#`-free non-negative integer) and
 * the request id is everything after the first `#`. That makes the split
 * unambiguous even if a request id ever contains a `#` — decode uses
 * `indexOf` on the leading numeric segment, so the request id is recovered
 * verbatim regardless of its contents.
 */
function encodeStreamToken(requestId: string, cursor: number): string {
  return `${cursor}#${requestId}`
}

function decodeStreamToken(token: string): { requestId: string; cursor: number } | null {
  const idx = token.indexOf('#')
  if (idx <= 0 || idx >= token.length - 1) return null
  const cursor = Number(token.slice(0, idx))
  const requestId = token.slice(idx + 1)
  if (!Number.isInteger(cursor) || cursor < 0) return null
  return { requestId, cursor }
}

/**
 * Build a `FullRequestData` payload from the live `Request` class
 * instance held in `CollectionStore` and push it into `ContextService`
 * so the next `HTTPExecutionService` read reflects the latest fields.
 *
 * Why this exists: the renderer's `HTTPRequestTabView` is supposed to
 * call `updateFullRequestData` on every field change, but the chain
 * relies on the tab being mounted AND its body / headers / URL state
 * effects firing in the right order. When MCP calls
 * `update_request(... body ...)` and then `run_request` back-to-back,
 * the renderer's mount-time `useState` may have already captured the
 * pre-patch body, and the post-patch `transport-replaced` event
 * doesn't always re-flush before the Send click fires. The result is
 * `HTTPExecutionService` reading a stale `fullData.body` (the symptom:
 * subsequent `Action Move` requests send the previous coordinates and
 * the API answers "already at destination"). Pushing from main here
 * sidesteps the renderer entirely and keeps the executor authoritative.
 */
/** Stringify a scenario variable map (name → already-resolved value) into the
 * name → string overlay the ContextService merges over the env context. */
function scenarioVarsToOverlay(vars: ReadonlyMap<string, unknown> | undefined): Record<string, string> | undefined {
  if (!vars || vars.size === 0) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of vars) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') out[k] = String(v)
    else { try { out[k] = JSON.stringify(v) } catch { /* skip unserialisable values */ } }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function flushRequestStateToContext(req: Request, scenarioVariables?: ReadonlyMap<string, unknown>): void {
  // Headers / params / pathParams / metadata are common across most
  // protocols — pull them off whichever shape the request takes.
  const headers = (req as { headers?: unknown }).headers
  const params = (req as { params?: unknown }).params
  const pathParams = (req as { pathParams?: unknown }).pathParams
  const metadata = (req as { metadata?: unknown }).metadata

  const data: Partial<FullRequestData> & { id: string } = {
    id: req.id,
    url: (req as { url?: string }).url ?? '',
    headers: Array.isArray(headers) ? (headers as FullRequestData['headers']) : []
  }
  if (isHTTPRequest(req) || isAuthenticationRequest(req)) {
    const http = req as HTTPRequest | AuthenticationRequest
    data.requestType = req.type === 'auth' ? 'auth' : 'http'
    data.method = http.method
    if (Array.isArray(params)) data.params = params as FullRequestData['params']
    if (Array.isArray(pathParams)) data.pathParams = pathParams as FullRequestData['pathParams']
    if (http.body !== undefined) data.body = http.body as FullRequestData['body']
  } else if (isGraphQLRequest(req)) {
    const gql = req as GraphQLRequest
    data.requestType = 'graphql'
    data.operationType = gql.operationType
    data.query = gql.query
    data.variables = gql.variables
    // Server mode (graphql mock host): the SDL + resolvers the mock serves.
    // Flushed so a scenario-hosted graphqlListen can read them off fullData.
    if (gql.server !== undefined) data.server = gql.server
    if (gql.schema !== undefined) data.schema = gql.schema
    if (gql.mockResolvers !== undefined) data.mockResolvers = gql.mockResolvers
    if (gql.resolverScript !== undefined) data.resolverScript = gql.resolverScript
  } else if (isGrpcRequest(req)) {
    const grpc = req as GrpcRequest
    data.requestType = 'grpc'
    data.service = grpc.service
    data.grpcMethod = grpc.method
    data.callType = grpc.callType
    if (grpc.transport !== undefined) data.transport = grpc.transport
    data.requestMessage = grpc.requestMessage
    // The dynamic client is built from the request's own proto; without it the
    // execution falls back to the bundled grpcbin proto and a custom-proto
    // request fails with "service not found".
    data.protoContent = grpc.protoContent
    data.protoPath = grpc.protoPath
    data.protoDescriptorSet = grpc.protoDescriptorSet
    if (Array.isArray(metadata)) data.metadata = metadata as FullRequestData['metadata']
  } else if (isSoapRequest(req)) {
    const soap = req as SoapRequest
    data.requestType = 'soap'
    data.soapAction = soap.soapAction
    data.soapService = soap.service
    data.operation = soap.operation
    data.soapBody = (soap as { body?: unknown }).body as string | undefined
    // Server mode: carry the hosted-mock config so a soapListen node (which
    // resolves operations from `fullData.soapMockOperations`) can serve them.
    if (soap.server !== undefined) data.server = soap.server
    if (soap.mockOperations !== undefined) data.soapMockOperations = soap.mockOperations
  } else if (isODataRequest(req)) {
    const odata = req as ODataRequest
    data.requestType = 'odata'
    if (Array.isArray(params)) data.params = params as FullRequestData['params']
    if (Array.isArray(pathParams)) data.pathParams = pathParams as FullRequestData['pathParams']
    data.odataVersion = odata.odataVersion
    data.odataOperationKind = odata.operationKind
    data.odataQueryOptions = { ...odata.queryOptions }
    // OData mock SERVER: the hosted service reads the CSDL + served entity data
    // from fullData (an `odataListen` scenario node never opens a request tab,
    // so this is the only path that populates them for a scenario run).
    if (odata.server !== undefined) data.server = odata.server
    if (odata.mockMetadata !== undefined) data.mockMetadata = odata.mockMetadata
    if (odata.mockData !== undefined) data.mockData = odata.mockData
  } else if (isWebSocketRequest(req)) {
    const ws = req as WebSocketRequest
    data.requestType = 'websocket'
    data.protocol = ws.protocol
    if ('event' in ws) (data as { event?: unknown }).event = (ws as { event?: unknown }).event
    if ('message' in ws) (data as { message?: unknown }).message = (ws as { message?: unknown }).message
  } else if (isJsonRpcRequest(req)) {
    const rpc = req as JsonRpcRequest
    data.requestType = 'jsonrpc'
    data.jsonRpcMethod = rpc.method
    data.jsonRpcParams = rpc.params
    data.jsonRpcId = rpc.rpcId
    if (rpc.notificationMode !== undefined) data.jsonRpcNotificationMode = rpc.notificationMode
  } else if (isJsonRpcBatchRequest(req)) {
    const batch = req as JsonRpcBatchRequest
    data.requestType = 'jsonrpcBatch'
    data.jsonRpcChildren = batch.children
  } else if (isTrpcRequest(req)) {
    const trpc = req as TrpcRequest
    data.requestType = 'trpc'
    data.trpcProcedure = trpc.procedure
    data.trpcInput = trpc.input
    data.trpcKind = trpc.kind
  } else if (isSseRequest(req)) {
    const sse = req as SseRequest
    data.requestType = 'sse'
    // The reconnect seed the request carries: SseExecutionService.resolveExecution
    // reads it off `fullData.lastEventId` on the FIRST connect. The interactive
    // tab pushes this via its own `updateFullRequestData` call on mount/change —
    // a scenario-driven sseConnect only ever goes through this flush, so without
    // it a request's saved `lastEventId` silently never reaches the wire.
    if (sse.lastEventId !== undefined) data.lastEventId = sse.lastEventId
  } else if (isAmqpRequest(req)) {
    const amqp = req as AmqpRequest
    data.requestType = 'amqp'
    data.mode = amqp.mode
    if (amqp.vhost !== undefined) data.vhost = amqp.vhost
    if (amqp.exchange !== undefined) data.exchange = amqp.exchange
    if (amqp.routingKey !== undefined) data.routingKey = amqp.routingKey
    if (amqp.payload !== undefined) data.payload = amqp.payload
    if (amqp.queue !== undefined) data.queue = amqp.queue
    if (amqp.autoAck !== undefined) data.autoAck = amqp.autoAck
    if (amqp.prefetch !== undefined) data.prefetch = amqp.prefetch
    if (amqp.browsePeekCount !== undefined) data.browsePeekCount = amqp.browsePeekCount
    if (amqp.username !== undefined) data.username = amqp.username
    if (amqp.password !== undefined) data.password = amqp.password
  } else if (isRedisRequest(req)) {
    const redis = req as RedisRequest
    data.requestType = 'redis'
    if (redis.password !== undefined) data.password = redis.password
    data.redisMode = redis.mode
    data.channels = redis.channels
    if (redis.command !== undefined) data.command = redis.command
    data.args = redis.args
    if (redis.freeformCommand !== undefined) data.freeformCommand = redis.freeformCommand
  } else if (isStompRequest(req)) {
    const stomp = req as StompRequest
    data.requestType = 'stomp'
    data.stompVersion = stomp.stompVersion
    data.connectHeaders = stomp.connectHeaders
    data.subscriptions = stomp.subscriptions
    data.sendDestination = stomp.sendDestination
    data.sendBody = stomp.sendBody
    data.sendHeaders = stomp.sendHeaders
  }
  // If the request isn't registered with ContextService yet, register
  // it inline. Until recently we bailed out here on the assumption
  // that `mcp:open-tab` would race the renderer's `registerRequest`
  // call ahead of our dispatch — that's true only when restorm has
  // already been running and the tree is reactive. On a *cold*
  // open_project → run_request sequence the renderer is still
  // hydrating, the request tab hasn't mounted, and
  // `getResolvedUrl` returns undefined → the executor short-circuits
  // with "No resolved URL found for this request" before the user
  // even sees what happened.
  //
  // Find the request's env-folder ancestor, pick its first
  // environment as a sane default (the renderer applies a richer
  // "selected env" cache when it mounts; the first env is the same
  // fallback the renderer uses if no selection has been recorded
  // yet), and register inline.
  if (contextService.getRequestContext(req.id) === undefined) {
    try {
      const envFolder = findEnvFolderAncestor(req.id)
      const envId = envFolder?.environments[0]?.id ?? null
      const headersArr = Array.isArray(headers) ? (headers as KeyValue[]) : []
      const paramsArr = Array.isArray(params) ? (params as KeyValue[]) : []
      const pathParamsArr = Array.isArray(pathParams) ? (pathParams as KeyValue[]) : []
      contextService.registerRequest(req.id, envId, {
        id: req.id,
        headers: headersArr,
        params: paramsArr,
        pathParams: pathParamsArr
      })
    } catch {
      // Vitest's main-side stubs don't expose `app.isPackaged`, so
      // the logger initialisation inside `registerRequest` throws —
      // and the `logger.debug` we'd use to surface this also throws
      // for the same reason. In production this never fires (Electron
      // populates `app.isPackaged`); silently skip so the rest of the
      // dispatch can proceed against whatever state the renderer has.
    }
  }
  try {
    contextService.updateFullRequestData(req.id, data as FullRequestData)
  } catch {
    // Vitest's main-side stubs don't expose `app.isPackaged`, so the
    // logger initialisation inside `updateFullRequestData`'s warn
    // path throws — and any `logger.debug` we'd use to report it
    // also throws for the same reason. In production this never
    // fires (Electron populates `app.isPackaged`); silently skip.
  }
  // Apply (or clear) the scenario `setVariable` overlay LAST, so the cached
  // resolved URL + KV transforms reflect a per-run override of an env variable.
  // Called every dispatch with the current run's variables (or undefined), so a
  // previous run's overlay never leaks into a later one.
  try {
    contextService.setScenarioVariables(req.id, scenarioVarsToOverlay(scenarioVariables))
  } catch {
    // Same vitest logger-stub guard as above.
  }
}

/**
 * Walk parent folders until an `EnvironmentFolder` is found. Bounded
 * iteration so a malformed tree (cycle, missing parent) can't loop
 * forever — restorm trees are at most a handful of levels deep in
 * practice.
 */
function findEnvFolderAncestor(itemId: string): EnvironmentFolder | null {
  let cursor = itemId
  for (let i = 0; i < 32; i++) {
    const parent = collectionStore.findParentFolder(cursor)
    if (!parent) return null
    if (isEnvironmentFolder(parent)) return parent
    cursor = parent.id
  }
  return null
}

/**
 * Run a unary (single-response) request by delegating to the renderer's
 * Send button + waiting for the new history entry to land. Used by HTTP /
 * OData / GraphQL / SOAP / gRPC + the auth request type.
 */
async function runUnaryRequest(req: Request, timeoutMs: number): Promise<unknown> {
  broadcastOpenTab(req.id)
  // Tab activation needs a render tick before the Send button is
  // mounted — give React time to flush the activation render.
  await delay(400)
  // Make sure ContextService sees the latest body / headers / URL
  // before the renderer-side Send click — see helper for the full
  // reason. Without this, an `update_request` immediately followed by
  // `run_request` can ship the pre-patch body.
  flushRequestStateToContext(req)
  const before = await responseHistoryService.list(req.id)
  const baselineGuid = before[0]?.guid ?? null
  dispatchSendInRenderer(req.id)
  const fresh = await waitForNewHistoryEntry(req.id, baselineGuid, timeoutMs)
  if (fresh === null) {
    return { error: { code: 'TIMEOUT', message: `renderer did not produce a response within ${timeoutMs}ms — open the tab manually and retry, or check the renderer console` } }
  }
  const detail = await responseHistoryService.getDetail(fresh.guid)
  if (detail === null) {
    return { error: { code: 'HISTORY_GONE', message: `history entry ${fresh.guid} disappeared between detection and read` } }
  }
  return await maybeTruncateBody(shapeHistoryDetail(detail))
}

/**
 * Open the WS connection via the renderer (Connect button), poll the
 * service's message buffer until a frame lands or the deadline hits,
 * then return whatever is buffered + a continuation token. Polling
 * (rather than a flat sleep) keeps the MCP channel responsive even
 * when the user passes a large `firstWaitMs` for a slow handshake.
 */
async function runStreamingWebsocketRequest(req: Request, firstWaitMs: number): Promise<unknown> {
  broadcastOpenTab(req.id)
  await delay(400)
  dispatchSendInRenderer(req.id)
  const deadline = Date.now() + firstWaitMs
  let snapshot = websocketExecutionService.getMessages(req.id) ?? { frames: [], total: 0 }
  while (Date.now() < deadline) {
    if (snapshot.frames.length > 0) break
    await delay(100)
    snapshot = websocketExecutionService.getMessages(req.id) ?? snapshot
  }
  return {
    requestId: req.id,
    protocol: 'websocket',
    streaming: true,
    success: websocketExecutionService.isActive(req.id),
    frameCount: snapshot.frames.length,
    frames: snapshot.frames,
    continuationToken: encodeStreamToken(req.id, snapshot.total),
    note: 'WebSocket connection is live. Use `read_stream(continuationToken)` to pull more frames; `cancel_request(id)` to disconnect.'
  }
}

export function registerExecutionTools(mcp: McpService): void {
  mcp.registerTool(
    'run_request',
    {
      titleKey: 'mcpToolTitles.runRequest',
      title: 'Run a request',
      description:
        'Execute the request with the given id and return its structured response. ' +
        'Unary protocols (HTTP / OData / GraphQL / SOAP / gRPC) return ' +
        '`{ status, statusText, headers, body, bodyContentType, durationMs, protocol, ' +
        'requestUrl, request: { method, url, headers, params, pathParams, body, ... }, error? }`; ' +
        'JSON bodies are parsed in-place. The `request` echo reflects exactly what hit the ' +
        'wire (handlebars-resolved URL, sent headers/params/body) so callers can audit the ' +
        'call without a second `get_response` round-trip. Streaming protocols (WebSocket) ' +
        'return the first frames + a `continuationToken` — pass it to `read_stream` to pull ' +
        'more, or `cancel_request(id)` to disconnect. The response is also persisted to the ' +
        'request\'s history (visible in the UI) and replayed live in the response panel.',
      inputSchema: {
        id: z.string().min(1).describe('Request id (from list_requests / search).'),
        timeoutMs: z.coerce.number().int().min(500).max(120_000).optional().describe(
          'Max time to wait for the response. Defaults to 30000ms for unary protocols, ' +
          '2000ms for the first frames of a streaming protocol.'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')

      const target: FolderItem | null = collectionStore.findById(id)
      if (target === null || !isRequest(target)) {
        return errorReply(`No request with id ${id}`)
      }
      const req = target
      const timeoutMs = typeof argRecord['timeoutMs'] === 'number' ? argRecord['timeoutMs'] : null

      const executor = PROTOCOL_EXECUTORS[req.type]
      return jsonReply(
        executor.streaming
          ? await runStreamingWebsocketRequest(req, timeoutMs ?? 2_000)
          : await runUnaryRequest(req, timeoutMs ?? 30_000)
      )
    }
  )

  mcp.registerTool(
    'cancel_request',
    {
      titleKey: 'mcpToolTitles.cancelRequest',
      title: 'Cancel an in-flight request',
      description:
        'Abort a request currently being executed. Routes to the matching protocol\'s ' +
        'cancel/disconnect path (HTTP/OData/auth → `httpExecutionService.cancel`, GraphQL → ' +
        '`graphqlExecutionService.cancel`, SOAP → `soapExecutionService.cancel`, gRPC → ' +
        '`grpcExecutionService.cancel`, WebSocket → `websocketExecutionService.disconnect`). ' +
        'Safe to call even if no execution is in flight — returns `{ cancelled: false }` ' +
        'instead of erroring.',
      inputSchema: {
        id: z.string().min(1).describe('Request id whose in-flight execution to cancel.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')

      const target: FolderItem | null = collectionStore.findById(id)
      if (target === null || !isRequest(target)) {
        return errorReply(`No request with id ${id}`)
      }
      const req = target

      const cancelled = PROTOCOL_EXECUTORS[req.type].cancel(id)
      return jsonReply({ requestId: id, protocol: req.type, cancelled })
    }
  )

  mcp.registerTool(
    'run_request_batch',
    {
      titleKey: 'mcpToolTitles.runRequestBatch',
      title: 'Run a list of requests sequentially',
      description:
        'Convenience wrapper around `run_request` for a list of request ids. Runs them one at ' +
        'a time, in input order, and returns the array of results in the same order. Stops ' +
        'early on an unknown id (returns the partial array + an `error` field). Distinct from ' +
        'OData `$batch` (which has its own semantics and is invoked via a single `odata-batch` ' +
        'request). Not to be confused with the generic `batch` tool which chains arbitrary MCP ' +
        'tool calls.',
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1).describe('Ordered list of request ids to run.'),
        timeoutMs: z.coerce.number().int().min(500).max(120_000).optional().describe(
          'Per-request timeout. Defaults to 30000ms for unary protocols.'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const idsRaw = argRecord['ids']
      if (!Array.isArray(idsRaw) || idsRaw.length === 0) return errorReply('ids must be a non-empty array')
      const ids: string[] = idsRaw.map((x) => typeof x === 'string' ? x : '').filter((s) => s.length > 0)
      if (ids.length === 0) return errorReply('ids must contain at least one non-empty string')
      const timeoutMs = typeof argRecord['timeoutMs'] === 'number' ? argRecord['timeoutMs'] : null

      const results: unknown[] = []
      for (const id of ids) {
        const target = collectionStore.findById(id)
        if (target === null || !isRequest(target)) {
          return jsonReply({
            ranCount: results.length,
            requestedCount: ids.length,
            results,
            error: { code: 'UNKNOWN_REQUEST', message: `No request with id ${id}; stopped early at index ${results.length}` }
          })
        }
        const req = target
        const executor = PROTOCOL_EXECUTORS[req.type]
        const result: unknown = executor.streaming
          ? await runStreamingWebsocketRequest(req, 2_000)
          : await runUnaryRequest(req, timeoutMs ?? 30_000)
        results.push(result)
      }
      return jsonReply({ ranCount: results.length, requestedCount: ids.length, results })
    }
  )

  mcp.registerTool(
    'read_stream',
    {
      titleKey: 'mcpToolTitles.readStream',
      title: 'Read more frames from a streaming request',
      description:
        'Pull more frames from a streaming request started by `run_request`. Pass the ' +
        '`continuationToken` returned by `run_request` (or by the previous `read_stream` call). ' +
        'Returns the next batch of frames + a fresh `continuationToken` for the call after that. ' +
        'When `done` is `true` (connection closed) the cursor stays valid — call again to ' +
        'confirm no late frames slipped in. WebSocket today; gRPC streaming when the gRPC ' +
        'service grows real streaming support.',
      inputSchema: {
        continuationToken: z.string().min(1).describe('Opaque token returned by `run_request` or `read_stream`.'),
        maxFrames: z.coerce.number().int().min(1).max(500).optional().describe(
          'Cap on the number of frames returned in this call. Defaults to 100.'
        ),
        waitMs: z.coerce.number().int().min(0).max(30_000).optional().describe(
          'If no new frames are available, wait up to this many ms for one to arrive. Defaults to 0 (return immediately).'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const token = typeof argRecord['continuationToken'] === 'string' ? argRecord['continuationToken'] : ''
      if (!token) return errorReply('continuationToken is required')
      const decoded = decodeStreamToken(token)
      if (decoded === null) return errorReply(`Malformed continuationToken: "${token}"`)
      const maxFrames = typeof argRecord['maxFrames'] === 'number' ? argRecord['maxFrames'] : 100
      const waitMs = typeof argRecord['waitMs'] === 'number' ? argRecord['waitMs'] : 0

      const { requestId, cursor } = decoded

      interface Snap { snap: { frames: import('../../services/WebSocketExecutionService').WebSocketMessage[]; total: number } | null; active: boolean }
      const sample = (): Snap => ({
        snap: websocketExecutionService.getMessages(requestId, cursor),
        active: websocketExecutionService.isActive(requestId)
      })

      let { snap, active } = sample()
      if ((snap === null || snap.frames.length === 0) && waitMs > 0) {
        const deadline = Date.now() + waitMs
        while (Date.now() < deadline) {
          await delay(100)
          ;({ snap, active } = sample())
          if (snap !== null && snap.frames.length > 0) break
        }
      }

      if (snap === null) {
        // Connection no longer in the active map — the WS closed and the
        // entry got dropped. Leave the cursor alone so a later poll is
        // still callable, but tell the AI no buffer exists.
        return jsonReply({
          requestId,
          frameCount: 0,
          frames: [],
          done: true,
          continuationToken: token,
          note: 'WebSocket connection closed; no live buffer available. Use `get_response_history` for the persisted record.'
        })
      }

      // Cursor overshoot detection: the buffer's `total` is shorter than
      // the cursor we were handed (would only happen if the WS service
      // ever rebuilt the buffer mid-session — not today, but cheap to
      // guard so the contract holds). Reset and tell the AI.
      const cursorReset = cursor > snap.total
      const slice = snap.frames.slice(0, maxFrames)
      // `getMessages` already clamps the start to `min(cursor, total)`
      // so when cursorReset is true we returned frames from index 0 —
      // the new cursor must reflect that reset position, not advance
      // from the bogus old cursor.
      const baseCursor = cursorReset ? 0 : cursor
      const newCursor = baseCursor + slice.length
      return jsonReply({
        requestId,
        frameCount: slice.length,
        frames: slice,
        done: !active,
        ...(cursorReset ? { cursorReset: true } : {}),
        continuationToken: encodeStreamToken(requestId, newCursor)
      })
    }
  )

  mcp.registerTool(
    'send_message',
    {
      titleKey: 'mcpToolTitles.sendMessage',
      title: 'Send a message on an open WebSocket / Socket.IO connection',
      description:
        'Emit a message on a connection already opened with `run_request`. For Socket.IO, `event` ' +
        'is the event name to emit; a server acknowledgement is captured as a received ' +
        '`<event> (ack)` frame, and a server that re-emits the event is captured too. Returns a ' +
        '`continuationToken` positioned just before this send, so `read_stream(continuationToken)` ' +
        'returns the sent frame plus any replies (echo / ack / pushed events). Errors if the ' +
        'request is not currently connected — call `run_request` first.',
      inputSchema: {
        id: z.string().min(1).describe('Request id of the open WebSocket / Socket.IO connection.'),
        message: z.string().describe('Message payload to send (JSON or raw text).'),
        event: z.string().optional().describe('Socket.IO event name to emit on. Ignored for raw WebSocket.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')
      const message = typeof argRecord['message'] === 'string' ? argRecord['message'] : ''
      const event = typeof argRecord['event'] === 'string' ? argRecord['event'] : undefined

      const target: FolderItem | null = collectionStore.findById(id)
      if (target === null || !isRequest(target)) return errorReply(`No request with id ${id}`)
      const req = target
      if (req.type !== 'websocket') {
        return errorReply(`send_message: request ${id} is not a WebSocket/Socket.IO request (type "${req.type}")`)
      }
      if (!websocketExecutionService.isActive(id)) {
        return errorReply(`send_message: request ${id} is not connected. Call run_request first to open the connection.`)
      }

      // Capture the buffer position before the send so the returned token's
      // read_stream yields the sent frame + the replies that follow.
      const before = websocketExecutionService.getMessages(id)?.total ?? 0
      const sent = websocketExecutionService.send(id, message, event)
      return jsonReply({
        requestId: id,
        sent,
        continuationToken: encodeStreamToken(id, before),
        note: sent
          ? 'Message sent. Use `read_stream(continuationToken)` to read the sent frame + any replies (echo / ack / pushed events).'
          : 'Send failed — the connection may have just closed.'
      })
    }
  )

  mcp.registerTool(
    'get_response_history',
    {
      titleKey: 'mcpToolTitles.getResponseHistory',
      title: 'Get a request\'s response history',
      description:
        'Return the most recent stored responses for a request. Each entry is a lightweight ' +
        'summary `{ guid, requestId, status, durationMs, executedAt, protocol, pinned }`; pull ' +
        'a full payload via `get_response(historyEntryId)`. Useful for "what did this endpoint ' +
        'return last time?" without re-running.',
      inputSchema: {
        requestId: z.string().min(1).describe('Request id whose history to fetch.'),
        limit: z.coerce.number().int().min(1).max(200).optional().describe(
          'Max entries to return. Defaults to all stored (cap configured per project).'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const requestId = typeof argRecord['requestId'] === 'string' ? argRecord['requestId'] : ''
      if (!requestId) return errorReply('requestId is required')
      const limit = typeof argRecord['limit'] === 'number' ? argRecord['limit'] : null
      const entries = await responseHistoryService.list(requestId)
      const truncated = limit !== null && entries.length > limit ? entries.slice(0, limit) : entries
      return jsonReply({ requestId, count: truncated.length, totalAvailable: entries.length, entries: truncated })
    }
  )

  mcp.registerTool(
    'get_response',
    {
      titleKey: 'mcpToolTitles.getResponse',
      title: 'Get the full payload of a stored response',
      description:
        'Return the full body + headers of a stored response entry. The payload is already ' +
        'redacted by the response-history service when the "redact secrets" project setting is ' +
        'on (default on); the AI never sees plaintext secrets even if the live response carried ' +
        'them. Pair with `get_response_history` to discover entry guids.',
      inputSchema: {
        historyEntryId: z.string().min(1).describe('Entry guid (from `get_response_history`).')
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const guid = typeof argRecord['historyEntryId'] === 'string' ? argRecord['historyEntryId'] : ''
      if (!guid) return errorReply('historyEntryId is required')
      const detail = await responseHistoryService.getDetail(guid)
      if (detail === null) return errorReply(`No history entry with guid ${guid}`)
      return jsonReply(detail)
    }
  )
}

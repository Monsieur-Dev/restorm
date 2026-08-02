import { randomUUID } from 'crypto'
import {
  eventBusService,
  logger,
  type Subscription
} from 'electron-core-ui/main'
import {
  DocumentEvents,
  type DocumentDeletedPayload
} from './DocumentEvents'
import { collectionStore } from './CollectionStore'
import { contextService } from './ContextService'
import type { KeyValue } from '../../shared/models'
import {
  getHistoryArchivePath,
  readHistoryArchive,
  writeHistoryArchive,
  queueHistoryWrite,
  INDEX_FILE_NAME,
  RESPONSES_FOLDER,
  type HistoryArchiveIndex
} from './historyArchive'
import {
  isRequest
} from '../../shared/models'
import type {
  ResponseHistoryDetail,
  ResponseHistoryEntry,
  ResponseHistoryHttpBody,
  ResponseHistoryKeyValue,
  ResponseHistoryOutcome,
  ResponseHistoryRequestMeta,
  ResponseHistoryRequestType,
  ResponseHistoryResponse,
  ResponseHistoryJsonRpcBatchChild
} from '../../shared/types/collections'
import type { HTTPExecutionResult } from './HTTPExecutionService'
import type { GraphQLExecutionResult } from './GraphQLExecutionService'
import type { GRPCExecutionResult } from './GRPCExecutionService'
import type { SOAPExecutionResult } from './SOAPExecutionService'
import type { WebSocketExecutionResult } from './WebSocketExecutionService'
import type { JsonRpcExecutionResult, JsonRpcBatchExecutionResult } from './JsonRpcExecutionService'
import type { TrpcExecutionResult } from './TrpcExecutionService'
import type { SseExecutionResult } from './SseExecutionService'
import type { AmqpExecutionResult } from './AMQPExecutionService'
import type { RedisExecutionResult } from './RedisExecutionService'
import type { StompExecutionResult } from './StompExecutionService'
import type { KafkaExecutionResult } from './KafkaExecutionService'
import { normalizeODataResponse } from '../../shared/utils/odataResponse'
import { redactTokensFromBody, collectTokenValues, redactTokensFromHeaders } from './AuthenticationRedaction'
import { isAuthenticationRequest } from '../../shared/types/collections'

const DEFAULT_MAX_PER_REQUEST = 10

type ExecutionResult =
  | HTTPExecutionResult
  | GraphQLExecutionResult
  | GRPCExecutionResult
  | SOAPExecutionResult
  | WebSocketExecutionResult
  | JsonRpcExecutionResult
  | JsonRpcBatchExecutionResult
  | TrpcExecutionResult
  | SseExecutionResult
  | AmqpExecutionResult
  | RedisExecutionResult
  | StompExecutionResult
  | KafkaExecutionResult

/**
 * Compute the 3-way visual outcome (`ok` / `warning` / `failure`) for
 * a result that exposes an HTTP status code. The history-list dot
 * uses this directly: green for 2xx, orange for 3xx (a redirect that
 * the client surfaced as the final response — debatable but
 * consistent with `HTTPResponsePanel.getStatusColor`), red for any
 * other code or a network-level failure.
 */
function httpOutcome(result: { success: boolean; statusCode?: number }): ResponseHistoryOutcome {
  if (!result.success) return 'failure'
  const status = result.statusCode ?? 0
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'warning'
  return 'failure'
}

/**
 * gRPC has no warning state — its status code is `0` for OK and any
 * non-zero value indicates an error (UNAVAILABLE, UNAUTHENTICATED,
 * etc.). We collapse to a binary outcome.
 */
/** gRPC status 0 == OK; any other code (or a missing one) is a failure. */
const GRPC_STATUS_OK = 0
function grpcOutcome(result: GRPCExecutionResult): ResponseHistoryOutcome {
  if (!result.success) return 'failure'
  return result.statusCode === GRPC_STATUS_OK ? 'ok' : 'failure'
}

/**
 * WebSocket carries no per-message status — the connection itself is
 * either established or not. The execution result reflects that with
 * `connected` + `success`; we treat both as required for `ok`.
 */
function webSocketOutcome(result: WebSocketExecutionResult): ResponseHistoryOutcome {
  return result.success && result.connected ? 'ok' : 'failure'
}

/** Same binary shape as {@link webSocketOutcome} — SSE has no per-frame status
 * either, only whether the stream ever connected and ended cleanly. */
function sseOutcome(result: SseExecutionResult): ResponseHistoryOutcome {
  return result.success && result.connected ? 'ok' : 'failure'
}

/**
 * AMQP has no per-message status either — publish/browse/subscribe each
 * settle to a single success/failure the same way WebSocket does.
 */
function amqpOutcome(result: AmqpExecutionResult): ResponseHistoryOutcome {
  return result.success ? 'ok' : 'failure'
}

/**
 * Redis command mode carries no connection concept — a command either
 * succeeded or errored. Subscribe mode reuses the WebSocket rule (`success`
 * AND `connected` are both required for `ok`).
 */
function redisOutcome(result: RedisExecutionResult): ResponseHistoryOutcome {
  if (!result.success) return 'failure'
  if (result.mode === 'subscribe') return result.connected === true ? 'ok' : 'failure'
  return 'ok'
}

/** Same binary shape as WebSocket: a STOMP connection is either established
 * (CONNECT/CONNECTED settled) or not. */
function stompOutcome(result: StompExecutionResult): ResponseHistoryOutcome {
  return result.success && result.connected ? 'ok' : 'failure'
}

/** Kafka has no per-message status like HTTP, and unlike WebSocket a produce/
 * browse result carries no "connected" concept — the execution result's own
 * `success` is authoritative for all three modes. */
function kafkaOutcome(result: KafkaExecutionResult): ResponseHistoryOutcome {
  return result.success ? 'ok' : 'failure'
}

function outcomeToSuccess(outcome: ResponseHistoryOutcome): boolean {
  return outcome !== 'failure'
}

/**
 * A JSON-RPC call can transport-succeed (HTTP 200) while the envelope
 * reports an application-level `error` — that's still a failed call from
 * the user's perspective, so it collapses to `failure` here (no separate
 * `warning` state, mirroring gRPC/WebSocket rather than the HTTP redirect
 * 3-way).
 */
function jsonRpcOutcome(result: JsonRpcExecutionResult): ResponseHistoryOutcome {
  if (!result.success || result.error !== undefined) return 'failure'
  return 'ok'
}

/**
 * A batch outcome is `ok` only when every child resolved with a `result`;
 * one or more child `error` / unmatched entries downgrades to `warning`
 * (the batch itself still transported and got A response) — full transport
 * failure is `failure`.
 */
function jsonRpcBatchOutcome(result: JsonRpcBatchExecutionResult): ResponseHistoryOutcome {
  if (!result.success) return 'failure'
  const hasIssue = result.children.some((c) => c.error !== undefined || c.unmatched === true)
  return hasIssue ? 'warning' : 'ok'
}

class ResponseHistoryService {
  private subscriptions: Subscription[] = []
  private initialized = false
  /** Per-request listeners woken when a new history entry is stored, so callers
   * (e.g. the MCP `run_request` flow) can await the new entry instead of
   * busy-polling `list()` (disk/IPC) on a fixed interval. */
  private readonly storeWaiters = new Map<string, Set<(guid: string) => void>>()

  /**
   * Resolve once a NEW history entry (guid !== baselineGuid) lands for
   * `requestId`, or to `null` after `timeoutMs`. Checks the current top first
   * (the entry may already exist), then waits on a store notification — no
   * polling loop.
   */
  async waitForNewEntry(requestId: string, baselineGuid: string | null, timeoutMs: number): Promise<{ guid: string } | null> {
    const top = (await this.list(requestId))[0]
    if (top !== undefined && top.guid !== baselineGuid) return { guid: top.guid }

    return new Promise((resolve) => {
      let settled = false
      const set = this.storeWaiters.get(requestId) ?? new Set()
      const listener = (guid: string): void => {
        if (settled || guid === baselineGuid) return
        settled = true
        cleanup()
        resolve({ guid })
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        set.delete(listener)
        if (set.size === 0) this.storeWaiters.delete(requestId)
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        resolve(null)
      }, timeoutMs)
      set.add(listener)
      this.storeWaiters.set(requestId, set)
    })
  }

  private notifyStored(requestId: string, guid: string): void {
    const set = this.storeWaiters.get(requestId)
    if (!set) return
    for (const listener of [...set]) {
      try { listener(guid) } catch { /* listener errors must not derail a store */ }
    }
  }

  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    this.subscriptions = [
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (payload) => {
        void this.handleRequestDeleted(payload.id)
      })
    ]
  }

  dispose(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe()
    }
    this.subscriptions = []
    this.initialized = false
  }

  async storeExecutionResult(
    requestId: string,
    type: ResponseHistoryRequestType,
    result: ExecutionResult
  ): Promise<void> {
    try {
      const archivePath = getHistoryArchivePath()
      if (!archivePath) {
        logger.debug('[ResponseHistoryService] No archive path, skipping history save')
        return
      }

      logger.debug('[ResponseHistoryService] Storing history entry', { requestId, type })

      const detail = this.buildDetail(requestId, type, result)
      if (!detail) {
        logger.warn('[ResponseHistoryService] Failed to build response detail', { requestId, type })
        return
      }

      await queueHistoryWrite(async () => {
        const { index, entriesData } = await readHistoryArchive(archivePath)
        const guid = detail.guid

        const { updatedIndex, keptGuids } = this.addEntryAndPrune(index, detail)

        const nextEntriesData = new Map<string, string>()
        for (const [entryName, entryText] of entriesData.entries()) {
          if (entryName === INDEX_FILE_NAME) continue
          if (entryName.startsWith(`${RESPONSES_FOLDER}/`) && entryName.endsWith('.json')) {
            const entryGuid = entryName.slice(`${RESPONSES_FOLDER}/`.length, -'.json'.length)
            if (keptGuids.has(entryGuid)) nextEntriesData.set(entryName, entryText)
          } else {
            // Preserve other domains' entries (e.g. scenarioRuns/…) — this
            // service owns only the `responses/` slice.
            nextEntriesData.set(entryName, entryText)
          }
        }

        nextEntriesData.set(this.getDetailEntryName(guid), JSON.stringify(detail))
        await writeHistoryArchive(archivePath, updatedIndex, nextEntriesData)
        this.notifyStored(requestId, guid)
      })
    } catch (error) {
      logger.error('[ResponseHistoryService] Failed to store response history', {
        requestId,
        type,
        error: String(error)
      })
    }
  }

  async list(requestId: string): Promise<ResponseHistoryEntry[]> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return []

    const { index } = await readHistoryArchive(archivePath)
    const request = index.requests.find((req) => req.requestId === requestId)
    return request?.entries.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)) ?? []
  }

  async getDetail(guid: string): Promise<ResponseHistoryDetail | null> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return null

    const { entriesData } = await readHistoryArchive(archivePath)
    const entryName = this.getDetailEntryName(guid)
    const detailText = entriesData.get(entryName)
    if (!detailText) return null

    const parsed = this.parseHistoryDetail(detailText)
    if (!parsed) {
      logger.warn('[ResponseHistoryService] Failed to parse history detail', { guid })
      return null
    }
    return parsed
  }

  async togglePin(guid: string, pinned: boolean): Promise<boolean> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return false

    return queueHistoryWrite(async () => {
      const { index, entriesData } = await readHistoryArchive(archivePath)
      let entry: ResponseHistoryEntry | null = null
      for (const request of index.requests) {
        const found = request.entries.find((item) => item.guid === guid)
        if (found) {
          entry = found
          break
        }
      }
      if (!entry) return false

      entry.pinned = pinned
      const detailName = this.getDetailEntryName(guid)
      const detailText = entriesData.get(detailName)
      if (detailText) {
        const parsed = this.parseHistoryDetail(detailText)
        if (parsed) {
          parsed.pinned = pinned
          entriesData.set(detailName, JSON.stringify(parsed))
        } else {
          logger.warn('[ResponseHistoryService] Failed to update detail pin', { guid })
        }
      }

      await writeHistoryArchive(archivePath, index, entriesData)
      return true
    })
  }

  private async handleRequestDeleted(requestId: string): Promise<void> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return

    await queueHistoryWrite(async () => {
      const { index, entriesData } = await readHistoryArchive(archivePath)
      const removedRequest = index.requests.find((req) => req.requestId === requestId)
      const removedGuids = new Set(removedRequest?.entries.map((e) => e.guid) ?? [])
      const remainingRequests = index.requests.filter((req) => req.requestId !== requestId)

      if (removedGuids.size === 0) return

      const nextEntriesData = new Map<string, string>()
      for (const [entryName, entryText] of entriesData.entries()) {
        if (entryName === INDEX_FILE_NAME) continue
        if (entryName.startsWith(`${RESPONSES_FOLDER}/`) && entryName.endsWith('.json')) {
          const entryGuid = entryName.slice(`${RESPONSES_FOLDER}/`.length, -'.json'.length)
          if (!removedGuids.has(entryGuid)) nextEntriesData.set(entryName, entryText)
        } else {
          // Preserve other domains' entries (scenarioRuns/…).
          nextEntriesData.set(entryName, entryText)
        }
      }

      await writeHistoryArchive(archivePath, {
        ...index,
        requests: remainingRequests
      }, nextEntriesData)
    })
  }

  private addEntryAndPrune(index: HistoryArchiveIndex, detail: ResponseHistoryDetail): { updatedIndex: HistoryArchiveIndex; keptGuids: Set<string> } {
    const entry: ResponseHistoryEntry = {
      guid: detail.guid,
      timestamp: detail.timestamp,
      pinned: detail.pinned,
      success: detail.success,
      ...(detail.outcome !== undefined ? { outcome: detail.outcome } : {})
    }

    const requests = index.requests.map((req) => ({ ...req, entries: [...req.entries] }))
    let target = requests.find((req) => req.requestId === detail.requestId)
    if (!target) {
      target = { requestId: detail.requestId, entries: [] }
      requests.push(target)
    }
    target.entries.push(entry)

    const pinnedEntries = target.entries.filter((item) => item.pinned)
    const nonPinnedEntries = target.entries
      .filter((item) => !item.pinned)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    const keptNonPinned = nonPinnedEntries.slice(0, DEFAULT_MAX_PER_REQUEST)
    const keepGuids = new Set([...pinnedEntries, ...keptNonPinned].map((item) => item.guid))

    target.entries = target.entries.filter((item) => keepGuids.has(item.guid))

    const keptGuidsAll = new Set<string>()
    for (const req of requests) {
      for (const item of req.entries) {
        keptGuidsAll.add(item.guid)
      }
    }

    return { updatedIndex: { ...index, requests: requests.filter((req) => req.entries.length > 0) }, keptGuids: keptGuidsAll }
  }

  private buildDetail(
    requestId: string,
    type: ResponseHistoryRequestType,
    result: ExecutionResult
  ): ResponseHistoryDetail | null {
    const requestMeta = this.getRequestMeta(requestId)
    const now = result.timings.startedAt
    const guid = randomUUID()

    // Append-only per-protocol builder table: each row picks the protocol's
    // `response` builder + `outcome` classifier; the detail envelope
    // (guid/success/timestamp/…) is identical across protocols and is assembled
    // once below. A new protocol adds ONE row here — no `switch` case.
    const builders: Record<ResponseHistoryRequestType, {
      build: (id: string, r: ExecutionResult) => ResponseHistoryDetail['response'] | null
      outcome: (r: ExecutionResult) => ReturnType<typeof httpOutcome>
    }> = {
      http: { build: (id, r) => this.buildHttpResponse(id, r as HTTPExecutionResult), outcome: (r) => httpOutcome(r as HTTPExecutionResult) },
      odata: { build: (id, r) => this.buildOdataResponse(id, r as HTTPExecutionResult), outcome: (r) => httpOutcome(r as HTTPExecutionResult) },
      graphql: { build: (id, r) => this.buildGraphqlResponse(id, r as GraphQLExecutionResult), outcome: (r) => httpOutcome(r as GraphQLExecutionResult) },
      grpc: { build: (id, r) => this.buildGrpcResponse(id, r as GRPCExecutionResult), outcome: (r) => grpcOutcome(r as GRPCExecutionResult) },
      soap: { build: (id, r) => this.buildSoapResponse(id, r as SOAPExecutionResult), outcome: (r) => httpOutcome(r as SOAPExecutionResult) },
      websocket: { build: (id, r) => this.buildWebSocketResponse(id, r as WebSocketExecutionResult), outcome: (r) => webSocketOutcome(r as WebSocketExecutionResult) },
      jsonrpc: { build: (id, r) => this.buildJsonRpcResponse(id, r as JsonRpcExecutionResult), outcome: (r) => jsonRpcOutcome(r as JsonRpcExecutionResult) },
      jsonrpcBatch: { build: (id, r) => this.buildJsonRpcBatchResponse(id, r as JsonRpcBatchExecutionResult), outcome: (r) => jsonRpcBatchOutcome(r as JsonRpcBatchExecutionResult) },
      trpc: { build: (id, r) => this.buildTrpcResponse(id, r as TrpcExecutionResult), outcome: (r) => httpOutcome(r as TrpcExecutionResult) },
      sse: { build: (id, r) => this.buildSseResponse(id, r as SseExecutionResult), outcome: (r) => sseOutcome(r as SseExecutionResult) },
      amqp: { build: (id, r) => this.buildAmqpResponse(id, r as AmqpExecutionResult), outcome: (r) => amqpOutcome(r as AmqpExecutionResult) },
      redis: { build: (id, r) => this.buildRedisResponse(id, r as RedisExecutionResult), outcome: (r) => redisOutcome(r as RedisExecutionResult) },
      stomp: { build: (id, r) => this.buildStompResponse(id, r as StompExecutionResult), outcome: (r) => stompOutcome(r as StompExecutionResult) },
      kafka: { build: (id, r) => this.buildKafkaResponse(id, r as KafkaExecutionResult), outcome: (r) => kafkaOutcome(r as KafkaExecutionResult) }
    }

    const builder = builders[type]
    const response = builder.build(requestId, result)
    if (!response) return null
    const outcome = builder.outcome(result)
    return {
      guid,
      requestId,
      type,
      success: outcomeToSuccess(outcome),
      outcome,
      timestamp: now,
      pinned: false,
      ...(requestMeta !== undefined ? { requestMeta } : {}),
      response
    }
  }

  private buildHttpResponse(requestId: string, result: HTTPExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestMethod = this.getRequestMethod(requestId)
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const requestParams = this.getResolvedKeyValues(requestId, 'params')
    const requestPathParams = this.getResolvedKeyValues(requestId, 'pathParams')

    const requestBodyData = this.getRequestBodyData(requestId)
    const requestBody = requestBodyData ? this.buildHttpBody(requestId, requestBodyData, requestHeaders) : undefined

    let responseHeaders = this.headersRecordToKeyValues(result.headers)
    const contentTypeHeader = result.headers?.['content-type']
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    const contentLengthHeader = result.headers?.['content-length']
    const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined

    // Redact token-bearing fields before they land in the on-disk
    // history archive. The lookup is best-effort: if the request
    // isn't in the collection (e.g. an ephemeral auth run), there's
    // no producedHeaders list to consult and we leave the body as-is.
    let responseBody = result.body ?? ''
    const collectionItem = collectionStore.findById(requestId)
    if (collectionItem && isRequest(collectionItem) && isAuthenticationRequest(collectionItem)) {
      const produced = collectionItem.producedHeaders.map((h) => ({
        key: h.key,
        value: h.value.toString(),
        enabled: h.enabled
      }))
      // Capture the resolved token VALUES from the JSON body so they
      // can be scrubbed from the (non-JSON) body AND the response
      // headers — a token often echoes back in a Set-Cookie / custom
      // header, which used to persist in clear on disk.
      const tokenValues = collectTokenValues(responseBody, produced)
      responseBody = redactTokensFromBody(responseBody, produced, tokenValues)
      responseHeaders = redactTokensFromHeaders(responseHeaders, tokenValues)
    }

    return {
      type: 'http',
      requestUrl: resolvedUrl,
      requestMethod,
      requestHeaders,
      requestParams,
      requestPathParams,
      ...(requestBody ? { requestBody } : {}),
      statusCode: result.statusCode ?? 0,
      statusText: result.statusText ?? '',
      responseHeaders,
      responseBody,
      ...(contentType ? { contentType } : {}),
      ...(contentLength !== undefined && !isNaN(contentLength) ? { contentLength } : {}),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildOdataResponse(requestId: string, result: HTTPExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const requestParams = this.getResolvedKeyValues(requestId, 'params')

    const requestContext = contextService.getRequestContext(requestId)
    const fullData = requestContext?.fullData
    const odataVersion: 'v2' | 'v3' | 'v4' | 'v4.01' = fullData?.odataVersion ?? 'v4'
    const operationKind: 'entity-set' | 'function' | 'action' | 'batch' =
      fullData?.odataOperationKind ?? 'entity-set'
    // `getRequestMeta` has no 'odata' branch, and OData requests carry
    // no explicit `method` on `fullData`. Derive the dispatched method
    // from the operation kind so history replay shows GET / POST
    // correctly per kind.
    const requestMethod = operationKind === 'action' || operationKind === 'batch' ? 'POST' : 'GET'
    const queryOptions = fullData?.odataQueryOptions
      ? this.normalizeODataQueryOptions(fullData.odataQueryOptions)
      : undefined

    const responseHeaders = this.headersRecordToKeyValues(result.headers)
    const contentTypeHeader = result.headers?.['content-type']
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    const contentLengthHeader = result.headers?.['content-length']
    const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined

    let odataCount: number | undefined
    let odataNextLink: string | undefined
    let odataDeltaLink: string | undefined
    if (result.body) {
      try {
        const parsed: unknown = JSON.parse(result.body)
        if (parsed !== null && typeof parsed === 'object') {
          const normalized = normalizeODataResponse(parsed, odataVersion)
          if (normalized) {
            if (normalized.count !== undefined) odataCount = normalized.count
            if (normalized.nextLink) odataNextLink = normalized.nextLink
            if (normalized.deltaLink) odataDeltaLink = normalized.deltaLink
          }
        }
      } catch {
        // Non-JSON body — nothing to extract.
      }
    }

    return {
      type: 'odata',
      requestUrl: resolvedUrl,
      requestMethod,
      requestHeaders,
      requestParams,
      odataVersion,
      operationKind,
      ...(queryOptions ? { queryOptions } : {}),
      statusCode: result.statusCode ?? 0,
      statusText: result.statusText ?? '',
      responseHeaders,
      responseBody: result.body ?? '',
      ...(contentType ? { contentType } : {}),
      ...(contentLength !== undefined && !isNaN(contentLength) ? { contentLength } : {}),
      ...(odataCount !== undefined ? { odataCount } : {}),
      ...(odataNextLink ? { odataNextLink } : {}),
      ...(odataDeltaLink ? { odataDeltaLink } : {}),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private normalizeODataQueryOptions(options: {
    filter?: string
    select?: string[]
    top?: string
    skip?: string
    count?: boolean
    expand?: string
    orderby?: string
    search?: string
    format?: string
    apply?: string
  }): Record<string, string | boolean | string[]> {
    const normalized: Record<string, string | boolean | string[]> = {}
    if (options.filter) normalized.filter = options.filter
    if (options.select && options.select.length > 0) normalized.select = options.select
    if (options.top) normalized.top = options.top
    if (options.skip) normalized.skip = options.skip
    if (options.count === true) normalized.count = true
    if (options.expand) normalized.expand = options.expand
    if (options.orderby) normalized.orderby = options.orderby
    if (options.search) normalized.search = options.search
    if (options.format) normalized.format = options.format
    if (options.apply) normalized.apply = options.apply
    return normalized
  }

  private buildGraphqlResponse(requestId: string, result: GraphQLExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const responseHeaders = this.headersRecordToKeyValues(result.headers)

    return {
      type: 'graphql',
      requestUrl: resolvedUrl,
      requestHeaders,
      statusCode: result.statusCode ?? 0,
      data: result.data,
      errors: result.errors,
      responseHeaders,
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildJsonRpcResponse(requestId: string, result: JsonRpcExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const fullData = this.getRequestFullData(requestId)
    const method = typeof fullData?.['jsonRpcMethod'] === 'string' ? fullData['jsonRpcMethod'] : ''

    return {
      type: 'jsonrpc',
      requestUrl: resolvedUrl,
      requestHeaders,
      method,
      statusCode: result.statusCode ?? 0,
      statusText: result.statusText ?? '',
      ...(result.notificationSent !== undefined ? { notificationSent: result.notificationSent } : {}),
      ...(result.result !== undefined ? { result: result.result } : {}),
      ...(result.error !== undefined ? { rpcError: result.error } : {}),
      timings: result.timings,
      ...(result.transportError !== undefined ? { error: result.transportError } : {})
    }
  }

  private buildJsonRpcBatchResponse(requestId: string, result: JsonRpcBatchExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const fullData = this.getRequestFullData(requestId)
    const childMethodById = new Map<string, string>()
    const rawChildren = fullData?.['jsonRpcChildren']
    if (Array.isArray(rawChildren)) {
      for (const c of rawChildren) {
        if (this.isRecord(c) && typeof c['childId'] === 'string' && typeof c['method'] === 'string') {
          childMethodById.set(c['childId'], c['method'])
        }
      }
    }
    const children: ResponseHistoryJsonRpcBatchChild[] = result.children.map((c) => ({
      childId: c.childId,
      rpcId: c.rpcId,
      method: childMethodById.get(c.childId) ?? '',
      ...(c.result !== undefined ? { result: c.result } : {}),
      ...(c.error !== undefined ? { error: c.error } : {}),
      ...(c.unmatched !== undefined ? { unmatched: c.unmatched } : {})
    }))

    return {
      type: 'jsonrpcBatch',
      requestUrl: resolvedUrl,
      requestHeaders,
      statusCode: result.statusCode ?? 0,
      children,
      timings: result.timings,
      ...(result.transportError !== undefined ? { error: result.transportError } : {})
    }
  }

  private buildTrpcResponse(requestId: string, result: TrpcExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const responseHeaders = this.headersRecordToKeyValues(result.headers)
    const fullData = this.getRequestFullData(requestId)
    const requestProcedure = typeof fullData?.['trpcProcedure'] === 'string' ? fullData['trpcProcedure'] : ''
    const requestKind = fullData?.['trpcKind'] === 'mutation' ? 'mutation' : 'query'

    return {
      type: 'trpc',
      requestUrl: resolvedUrl,
      requestProcedure,
      requestKind,
      requestHeaders,
      statusCode: result.statusCode ?? 0,
      statusText: result.statusText ?? '',
      data: result.data,
      // The full `[{ result: { data } }]` (or error) wire envelope — the
      // "Show raw envelope" toggle's source.
      rawEnvelope: result.rawBody ?? '',
      responseHeaders,
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildGrpcResponse(requestId: string, result: GRPCExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestMessage = this.getRequestBodyContent(requestId)
    const requestMetadata = this.getResolvedKeyValues(requestId, 'headers')

    const responseMetadata = result.metadata
      ? Object.entries(result.metadata).map(([key, value]) => ({ key, value, enabled: true }))
      : []
    const messages = result.messages.map((m) => ({
      direction: m.direction,
      data: m.data,
      timestamp: m.timestamp
    }))

    return {
      type: 'grpc',
      requestUrl: resolvedUrl,
      requestMethod: result.requestMethod ?? '',
      requestMessage,
      requestMetadata,
      statusCode: result.statusCode ?? 12,
      statusMessage: result.statusMessage ?? '',
      responseMessage: result.responseMessage ?? '',
      responseMetadata,
      ...(messages.length > 0 ? { messages } : {}),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildSoapResponse(requestId: string, result: SOAPExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestBody = this.getRequestBodyContent(requestId)
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const soapAction = this.getRequestMeta(requestId)?.soapAction ?? ''

    return {
      type: 'soap',
      requestUrl: resolvedUrl,
      requestSoapAction: soapAction,
      requestBody,
      requestHeaders,
      statusCode: result.statusCode ?? 0,
      responseBody: result.responseBody ?? '',
      responseHeaders: this.headersRecordToKeyValues(result.headers),
      fault: result.fault,
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  /** The three Kafka modes have distinct result shapes (a single RecordMetadata
   * vs. a peeked/streamed message list) — `kafkaMode` on the stored response
   * lets the renderer branch without inspecting which optional fields are
   * populated. */
  private buildKafkaResponse(_requestId: string, result: KafkaExecutionResult): ResponseHistoryResponse | null {
    const messages = result.kafkaMode !== 'produce'
      ? result.messages.map((m) => ({
          direction: m.direction,
          topic: m.topic,
          partition: m.partition,
          offset: m.offset,
          ...(m.key !== undefined ? { key: m.key } : {}),
          value: m.value,
          ...(m.headers ? { headers: this.headersRecordToKeyValues(m.headers) } : {}),
          timestamp: m.timestamp
        }))
      : undefined

    return {
      type: 'kafka',
      kafkaMode: result.kafkaMode,
      requestUrl: result.requestUrl,
      requestTopic: result.requestTopic,
      ...(result.kafkaMode === 'produce'
        ? { ...(result.partition !== undefined ? { producedPartition: result.partition } : {}), ...(result.offset !== undefined ? { producedOffset: result.offset } : {}) }
        : {}),
      ...(messages ? { messages } : {}),
      ...(result.kafkaMode === 'consume' ? { connected: result.connected } : {}),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildWebSocketResponse(requestId: string, result: WebSocketExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const protocol = this.getRequestMeta(requestId)?.protocol ?? ''

    return {
      type: 'websocket',
      requestUrl: resolvedUrl,
      protocol,
      connected: result.connected,
      messages: result.messages.map((msg) => ({
        direction: msg.direction,
        data: msg.data,
        event: msg.event,
        timestamp: msg.timestamp
      })),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildSseResponse(requestId: string, result: SseExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''

    return {
      type: 'sse',
      requestUrl: resolvedUrl,
      connected: result.connected,
      frames: result.frames.map((frame) => ({
        event: frame.event,
        data: frame.data,
        id: frame.id,
        timestamp: frame.timestamp
      })),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildAmqpResponse(requestId: string, result: AmqpExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''

    return {
      type: 'amqp',
      requestUrl: resolvedUrl,
      mode: result.mode,
      connected: result.connected,
      messages: result.messages.map((msg) => ({
        direction: msg.direction,
        data: msg.data,
        ...(msg.exchange !== undefined ? { exchange: msg.exchange } : {}),
        ...(msg.routingKey !== undefined ? { routingKey: msg.routingKey } : {}),
        ...(msg.deliveryTag !== undefined ? { deliveryTag: msg.deliveryTag } : {}),
        ...(msg.peek !== undefined ? { peek: msg.peek } : {}),
        timestamp: msg.timestamp
      })),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildStompResponse(requestId: string, result: StompExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''

    return {
      type: 'stomp',
      requestUrl: resolvedUrl,
      connected: result.connected,
      messages: result.messages.map((msg) => ({
        direction: msg.direction,
        command: msg.command,
        subscription: msg.subscription,
        destination: msg.destination,
        headers: this.headersRecordToKeyValues(msg.headers),
        body: msg.body,
        timestamp: msg.timestamp
      })),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  /** Covers BOTH Redis modes — `result.mode` decides which optional fields are
   * populated (mirrors the discriminated `ResponseHistoryRedisResponse`). */
  private buildRedisResponse(requestId: string, result: RedisExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''

    return {
      type: 'redis',
      requestUrl: resolvedUrl,
      mode: result.mode,
      ...(result.channels !== undefined ? { channels: result.channels } : {}),
      ...(result.connected !== undefined ? { connected: result.connected } : {}),
      ...(result.messages !== undefined ? {
        messages: result.messages.map((msg) => ({
          direction: msg.direction,
          channel: msg.channel,
          data: msg.data,
          timestamp: msg.timestamp
        }))
      } : {}),
      ...(result.command !== undefined ? { command: result.command } : {}),
      ...(result.args !== undefined ? { args: result.args } : {}),
      ...(result.reply !== undefined ? { reply: result.reply } : {}),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
  }

  private buildHttpBody(
    requestId: string,
    body: { type?: string; content?: string; path?: string; fields?: unknown[] } | undefined,
    requestHeaders: ResponseHistoryKeyValue[] = []
  ): ResponseHistoryHttpBody | undefined {
    const bodyType = typeof body?.type === 'string' ? body.type : ''
    if (bodyType === 'text') {
      // Resolve exactly like the executor does — Content-Type-aware — so the
      // archived "what we sent" matches the bytes that went on the wire
      // instead of a differently-escaped (or unresolved) rendering of it.
      const contentType = requestHeaders.find((h) => h.key.toLowerCase() === 'content-type')?.value
      return {
        type: 'text',
        content: body?.content ? contextService.resolveBodyValue(body.content, requestId, contentType) : ''
      }
    }
    if (bodyType === 'file') {
      return {
        type: 'file',
        path: body?.path ?? ''
      }
    }
    if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') {
      const fields = Array.isArray(body?.fields) ? body.fields : []
      return {
        type: bodyType,
        fields: fields
          .map((field) => {
            const raw = field as { key?: string; value?: { toString?: () => string } | string; enabled?: boolean }
            const key = raw.key ?? ''
            const value = raw.value ?? ''
            if (!key) return null
            const valueStr = typeof value === 'string' ? value : value.toString ? value.toString() : ''
            return {
              key,
              value: contextService.resolveValue(valueStr, requestId),
              enabled: raw.enabled
            }
          })
          .filter((item): item is ResponseHistoryKeyValue => item !== null)
      }
    }
    return undefined
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  private parseHistoryDetail(text: string): ResponseHistoryDetail | null {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!this.isRecord(parsed)) return null
      if (typeof parsed['guid'] !== 'string') return null
      if (typeof parsed['requestId'] !== 'string') return null
      if (typeof parsed['type'] !== 'string') return null
      if (typeof parsed['timestamp'] !== 'string') return null
      if (!this.isRecord(parsed['response'])) return null
      return parsed as ResponseHistoryDetail
    } catch {
      return null
    }
  }

  private getRequestFullData(requestId: string): Record<string, unknown> | null {
    const ctx = contextService.getRequestContext(requestId) as unknown
    if (!this.isRecord(ctx)) return null
    const fullData = ctx['fullData']
    if (!this.isRecord(fullData)) return null
    return fullData
  }

  private getRequestMethod(requestId: string): string {
    const fullData = this.getRequestFullData(requestId)
    const method = fullData?.['method']
    if (typeof method === 'string') return method
    const metaMethod = this.getRequestMeta(requestId)?.method
    return typeof metaMethod === 'string' ? metaMethod : ''
  }

  private getRequestBodyData(requestId: string): { type?: string; content?: string; path?: string; fields?: unknown[] } | undefined {
    const fullData = this.getRequestFullData(requestId)
    const body = fullData?.['body']
    if (!this.isRecord(body)) return undefined
    const type = typeof body['type'] === 'string' ? body['type'] : undefined
    const content = typeof body['content'] === 'string' ? body['content'] : undefined
    const path = typeof body['path'] === 'string' ? body['path'] : undefined
    const fields = Array.isArray(body['fields']) ? body['fields'] : undefined
    return { type, content, path, fields }
  }

  private getRequestBodyContent(requestId: string): string {
    const body = this.getRequestBodyData(requestId)
    return typeof body?.content === 'string' ? body.content : ''
  }

  private getRequestMeta(requestId: string): ResponseHistoryRequestMeta | undefined {
    const request = collectionStore.findById(requestId) as unknown
    if (!this.isRecord(request)) return undefined
    const type = request['type']
    if (typeof type !== 'string') return undefined

    // Append-only per-protocol metadata extractors: each protocol surfaces a
    // different request-meta shape (HTTP → method, gRPC → service/method/
    // callType, …). Protocols absent from the table (odata/auth) carry no
    // history meta, matching the prior default. A new protocol adds ONE row.
    const extractors: Record<string, (r: Record<string, unknown>) => ResponseHistoryRequestMeta> = {
      http: (r) => ({ method: typeof r['method'] === 'string' ? r['method'] : '' }),
      graphql: () => ({ method: 'POST' }),
      grpc: (r) => ({
        service: typeof r['service'] === 'string' ? r['service'] : '',
        method: typeof r['method'] === 'string' ? r['method'] : '',
        callType: typeof r['callType'] === 'string' ? r['callType'] : ''
      }),
      soap: (r) => ({
        service: typeof r['service'] === 'string' ? r['service'] : '',
        operation: typeof r['operation'] === 'string' ? r['operation'] : '',
        soapAction: typeof r['soapAction'] === 'string' ? r['soapAction'] : ''
      }),
      websocket: (r) => ({
        protocol: typeof r['protocol'] === 'string' ? r['protocol'] : '',
        event: typeof r['event'] === 'string' ? r['event'] : ''
      }),
      trpc: (r) => ({
        operation: typeof r['procedure'] === 'string' ? r['procedure'] : '',
        method: r['kind'] === 'mutation' ? 'POST' : 'GET'
      }),
      redis: (r) => ({
        protocol: typeof r['mode'] === 'string' ? r['mode'] : '',
        method: typeof r['command'] === 'string' ? r['command'] : ''
      }),
      kafka: (r) => ({ topic: typeof r['topic'] === 'string' ? r['topic'] : '' })
    }
    const extractor = extractors[type]
    return extractor ? extractor(request) : undefined
  }

  private getResolvedKeyValues(requestId: string, groupName: string): ResponseHistoryKeyValue[] {
    const ctx = contextService.getRequestContext(requestId) as unknown
    if (!this.isRecord(ctx)) return []
    const keyValueGroups = ctx['keyValueGroups']
    if (!(keyValueGroups instanceof Map)) return []
    const group = keyValueGroups.get(groupName) as unknown
    if (!Array.isArray(group)) return []
    const values: ResponseHistoryKeyValue[] = []
    for (const kv of group) {
      if (!this.isRecord(kv)) continue
      if (kv.enabled === false) continue
      if (typeof kv.key !== 'string' || !kv.key) continue
      // Mirror the live dispatch resolution exactly (HTTP / GraphQL / gRPC /
      // WebSocket execution services, and the path/query param composer) so
      // this history / MCP echo never shows a substitution that didn't
      // actually happen on the wire, or the reverse: the KEY resolves
      // unconditionally through Handlebars (same as a param key or the URL —
      // a header/metadata name has no "type" to gate on); the VALUE stays
      // type-aware — only an `ExpressionValue` row is Handlebars-substituted,
      // a `StringValue` ships verbatim. `keyValueGroups` entries are the same
      // registered `KeyValue` instances the execution services resolve
      // against, so the cast mirrors `resolveKeyValueForRequest`'s existing
      // callers exactly.
      const resolvedKey = contextService.resolveValue(kv.key, requestId)
      // An unknown variable resolves to '', and the execution services drop
      // such a row (an empty header name is an invalid HTTP token). Drop it
      // here too — echoing it would show a header that never went on the wire.
      if (!resolvedKey) continue
      const resolvedValue = contextService.resolveKeyValueForRequest(kv as unknown as KeyValue, requestId)
      values.push({
        key: resolvedKey,
        value: resolvedValue,
        enabled: typeof kv.enabled === 'boolean' ? kv.enabled : undefined
      })
    }
    return values
  }

  private headersRecordToKeyValues(headers?: Record<string, string | string[]>): ResponseHistoryKeyValue[] {
    if (!headers) return []
    const entries: ResponseHistoryKeyValue[] = []
    for (const [key, value] of Object.entries(headers)) {
      entries.push({
        key,
        value: Array.isArray(value) ? value.join(', ') : value
      })
    }
    return entries
  }

  private getDetailEntryName(guid: string): string {
    return `${RESPONSES_FOLDER}/${guid}.json`
  }

}

export const responseHistoryService = new ResponseHistoryService()

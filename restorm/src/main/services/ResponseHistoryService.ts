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
  ResponseHistoryResponse
} from '../../shared/types/collections'
import type { HTTPExecutionResult } from './HTTPExecutionService'
import type { GraphQLExecutionResult } from './GraphQLExecutionService'
import type { GRPCExecutionResult } from './GRPCExecutionService'
import type { SOAPExecutionResult } from './SOAPExecutionService'
import type { WebSocketExecutionResult } from './WebSocketExecutionService'
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
function grpcOutcome(result: GRPCExecutionResult): ResponseHistoryOutcome {
  if (!result.success) return 'failure'
  return (result.statusCode ?? -1) === 0 ? 'ok' : 'failure'
}

/**
 * WebSocket carries no per-message status — the connection itself is
 * either established or not. The execution result reflects that with
 * `connected` + `success`; we treat both as required for `ok`.
 */
function webSocketOutcome(result: WebSocketExecutionResult): ResponseHistoryOutcome {
  return result.success && result.connected ? 'ok' : 'failure'
}

function outcomeToSuccess(outcome: ResponseHistoryOutcome): boolean {
  return outcome !== 'failure'
}

class ResponseHistoryService {
  private subscriptions: Subscription[] = []
  private initialized = false

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

    switch (type) {
      case 'http': {
        const httpResult = result as HTTPExecutionResult
        const response = this.buildHttpResponse(requestId, httpResult)
        if (!response) return null
        const outcome = httpOutcome(httpResult)
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
      case 'odata': {
        const httpResult = result as HTTPExecutionResult
        const response = this.buildOdataResponse(requestId, httpResult)
        if (!response) return null
        const outcome = httpOutcome(httpResult)
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
      case 'graphql': {
        const gqlResult = result as GraphQLExecutionResult
        const response = this.buildGraphqlResponse(requestId, gqlResult)
        if (!response) return null
        const outcome = httpOutcome(gqlResult)
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
      case 'grpc': {
        const grpcResult = result as GRPCExecutionResult
        const response = this.buildGrpcResponse(requestId, grpcResult)
        if (!response) return null
        const outcome = grpcOutcome(grpcResult)
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
      case 'soap': {
        const soapResult = result as SOAPExecutionResult
        const response = this.buildSoapResponse(requestId, soapResult)
        if (!response) return null
        const outcome = httpOutcome(soapResult)
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
      case 'websocket': {
        const wsResult = result as WebSocketExecutionResult
        const response = this.buildWebSocketResponse(requestId, wsResult)
        if (!response) return null
        const outcome = webSocketOutcome(wsResult)
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
      default:
        return null
    }
  }

  private buildHttpResponse(requestId: string, result: HTTPExecutionResult): ResponseHistoryResponse | null {
    const resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? result.requestUrl ?? ''
    const requestMethod = this.getRequestMethod(requestId)
    const requestHeaders = this.getResolvedKeyValues(requestId, 'headers')
    const requestParams = this.getResolvedKeyValues(requestId, 'params')
    const requestPathParams = this.getResolvedKeyValues(requestId, 'pathParams')

    const requestBodyData = this.getRequestBodyData(requestId)
    const requestBody = requestBodyData ? this.buildHttpBody(requestId, requestBodyData) : undefined

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
    const odataVersion: 'v2' | 'v3' | 'v4' = fullData?.odataVersion ?? 'v4'
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
    if (result.body) {
      try {
        const parsed: unknown = JSON.parse(result.body)
        if (parsed !== null && typeof parsed === 'object') {
          const normalized = normalizeODataResponse(parsed, odataVersion)
          if (normalized) {
            if (normalized.count !== undefined) odataCount = normalized.count
            if (normalized.nextLink) odataNextLink = normalized.nextLink
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
      responseHeaders: [],
      fault: result.fault,
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

  private buildHttpBody(
    requestId: string,
    body: { type?: string; content?: string; path?: string; fields?: unknown[] } | undefined
  ): ResponseHistoryHttpBody | undefined {
    const bodyType = typeof body?.type === 'string' ? body.type : ''
    if (bodyType === 'text') {
      return {
        type: 'text',
        content: body?.content ? contextService.resolveValue(body.content, requestId) : ''
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

    switch (type) {
      case 'http':
        return { method: typeof request['method'] === 'string' ? request['method'] : '' }
      case 'graphql':
        return { method: 'POST' }
      case 'grpc':
        return {
          service: typeof request['service'] === 'string' ? request['service'] : '',
          method: typeof request['method'] === 'string' ? request['method'] : '',
          callType: typeof request['callType'] === 'string' ? request['callType'] : ''
        }
      case 'soap':
        return {
          service: typeof request['service'] === 'string' ? request['service'] : '',
          operation: typeof request['operation'] === 'string' ? request['operation'] : '',
          soapAction: typeof request['soapAction'] === 'string' ? request['soapAction'] : ''
        }
      case 'websocket':
        return {
          protocol: typeof request['protocol'] === 'string' ? request['protocol'] : '',
          event: typeof request['event'] === 'string' ? request['event'] : ''
        }
      default:
        return undefined
    }
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
      const rawValue = kv.value
      let valueStr = ''
      if (typeof rawValue === 'string') {
        valueStr = rawValue
      } else if (this.isRecord(rawValue)) {
        const rawValueInner = rawValue.value
        if (typeof rawValueInner === 'string') {
          valueStr = rawValueInner
        } else if (typeof rawValueInner === 'number') {
          valueStr = String(rawValueInner)
        }
      }
      const resolved = contextService.resolveValue(valueStr, requestId)
      values.push({
        key: kv.key,
        value: resolved,
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

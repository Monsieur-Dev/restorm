import { existsSync, statSync } from 'fs'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  ZipReader,
  ZipWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter
} from '@zip.js/zip.js'
import {
  eventBusService,
  logger,
  type Subscription,
  getFileService,
  isFileServiceInitialized
} from 'electron-core-ui/main'
import {
  DocumentEvents,
  type DocumentChangedPayload,
  type DocumentDeletedPayload
} from './DocumentEvents'
import { collectionStore } from './CollectionStore'
import { contextService } from './ContextService'
import {
  isAnyFolder,
  isRequest,
  type FolderItem
} from '../../shared/models'
import type {
  ResponseHistoryDetail,
  ResponseHistoryEntry,
  ResponseHistoryHttpBody,
  ResponseHistoryIndex,
  ResponseHistoryKeyValue,
  ResponseHistoryRequestMeta,
  ResponseHistoryRequestType,
  ResponseHistoryResponse
} from '../../shared/types/collections'
import type { HTTPExecutionResult } from './HTTPExecutionService'
import type { GraphQLExecutionResult } from './GraphQLExecutionService'
import type { GRPCExecutionResult } from './GRPCExecutionService'
import type { SOAPExecutionResult } from './SOAPExecutionService'
import type { WebSocketExecutionResult } from './WebSocketExecutionService'

const DEFAULT_MAX_PER_REQUEST = 10
const INDEX_FILE_NAME = 'index.json'
const RESPONSES_FOLDER = 'responses'

type ExecutionResult =
  | HTTPExecutionResult
  | GraphQLExecutionResult
  | GRPCExecutionResult
  | SOAPExecutionResult
  | WebSocketExecutionResult

class ResponseHistoryService {
  private subscriptions: Subscription[] = []
  private initialized = false
  private writeQueue = Promise.resolve()

  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    this.subscriptions = [
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_UPDATED, (payload) => {
        void this.handleRequestUpdated(payload.id)
      }),
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
    const archivePath = this.getArchivePath()
    if (!archivePath) {
      logger.debug('[ResponseHistoryService] No archive path, skipping history save')
      return
    }

    const requestPath = this.getRequestPath(requestId)
    if (!requestPath) {
      logger.warn('[ResponseHistoryService] Request path not found, skipping history save', { requestId })
      return
    }

    const detail = this.buildDetail(requestId, requestPath, type, result)
    if (!detail) {
      logger.warn('[ResponseHistoryService] Failed to build response detail', { requestId, type })
      return
    }

    await this.queueWrite(async () => {
      const { index, entriesData } = await this.readArchive(archivePath)
      const guid = detail.guid

      const updatedEntries = this.addEntryAndPrune(index, detail)
      const keptGuids = new Set(updatedEntries.map((entry) => entry.guid))

      const nextEntriesData = new Map<string, string>()
      for (const [entryName, entryText] of entriesData.entries()) {
        if (entryName === INDEX_FILE_NAME) continue
        const match = entryName.startsWith(`${RESPONSES_FOLDER}/`) ? entryName.slice(`${RESPONSES_FOLDER}/`.length) : null
        if (match?.endsWith('.json')) {
          const entryGuid = match.slice(0, -'.json'.length)
          if (keptGuids.has(entryGuid)) {
            nextEntriesData.set(entryName, entryText)
          }
        }
      }

      nextEntriesData.set(this.getDetailEntryName(guid), JSON.stringify(detail))
      await this.writeArchive(archivePath, {
        ...index,
        entries: updatedEntries
      }, nextEntriesData)
    })
  }

  async list(requestId: string): Promise<ResponseHistoryEntry[]> {
    const archivePath = this.getArchivePath()
    if (!archivePath || !existsSync(archivePath)) return []

    const { index } = await this.readArchive(archivePath)
    return index.entries
      .filter((entry) => entry.requestId === requestId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }

  async getDetail(guid: string): Promise<ResponseHistoryDetail | null> {
    const archivePath = this.getArchivePath()
    if (!archivePath || !existsSync(archivePath)) return null

    const { entriesData } = await this.readArchive(archivePath)
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
    const archivePath = this.getArchivePath()
    if (!archivePath || !existsSync(archivePath)) return false

    return this.queueWrite(async () => {
      const { index, entriesData } = await this.readArchive(archivePath)
      const entry = index.entries.find((item) => item.guid === guid)
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

      await this.writeArchive(archivePath, index, entriesData)
      return true
    })
  }

  private async handleRequestUpdated(requestId: string): Promise<void> {
    const archivePath = this.getArchivePath()
    if (!archivePath || !existsSync(archivePath)) return

    const requestPath = this.getRequestPath(requestId)
    if (!requestPath) return

    await this.queueWrite(async () => {
      const { index, entriesData } = await this.readArchive(archivePath)
      let changed = false
      for (const entry of index.entries) {
        if (entry.requestId !== requestId) continue
        if (entry.requestPath !== requestPath) {
          entry.requestPath = requestPath
          changed = true
          const detailName = this.getDetailEntryName(entry.guid)
          const detailText = entriesData.get(detailName)
          if (detailText) {
            const parsed = this.parseHistoryDetail(detailText)
            if (parsed) {
              parsed.requestPath = requestPath
              entriesData.set(detailName, JSON.stringify(parsed))
            } else {
              logger.warn('[ResponseHistoryService] Failed to update detail requestPath', { guid: entry.guid })
            }
          }
        }
      }
      if (!changed) return

      await this.writeArchive(archivePath, index, entriesData)
    })
  }

  private async handleRequestDeleted(requestId: string): Promise<void> {
    const archivePath = this.getArchivePath()
    if (!archivePath || !existsSync(archivePath)) return

    await this.queueWrite(async () => {
      const { index, entriesData } = await this.readArchive(archivePath)
      const remainingEntries = index.entries.filter((entry) => entry.requestId !== requestId)
      if (remainingEntries.length === index.entries.length) return

      const remainingGuids = new Set(remainingEntries.map((entry) => entry.guid))
      const nextEntriesData = new Map<string, string>()
      for (const [entryName, entryText] of entriesData.entries()) {
        if (entryName === INDEX_FILE_NAME) continue
        const match = entryName.startsWith(`${RESPONSES_FOLDER}/`) ? entryName.slice(`${RESPONSES_FOLDER}/`.length) : null
        if (match?.endsWith('.json')) {
          const entryGuid = match.slice(0, -'.json'.length)
          if (remainingGuids.has(entryGuid)) {
            nextEntriesData.set(entryName, entryText)
          }
        }
      }

      await this.writeArchive(archivePath, {
        ...index,
        entries: remainingEntries
      }, nextEntriesData)
    })
  }

  private addEntryAndPrune(index: ResponseHistoryIndex, detail: ResponseHistoryDetail): ResponseHistoryEntry[] {
    const entry: ResponseHistoryEntry = {
      guid: detail.guid,
      requestId: detail.requestId,
      requestPath: detail.requestPath,
      type: detail.type,
      success: detail.success,
      timestamp: detail.timestamp,
      pinned: detail.pinned
    }

    const entries = [...index.entries, entry]
    const entriesForRequest = entries.filter((item) => item.requestId === detail.requestId)
    const pinnedEntries = entriesForRequest.filter((item) => item.pinned)
    const nonPinnedEntries = entriesForRequest
      .filter((item) => !item.pinned)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    const keptNonPinned = nonPinnedEntries.slice(0, index.maxPerRequest)
    const keepGuids = new Set([...pinnedEntries, ...keptNonPinned].map((item) => item.guid))

    return entries.filter((item) => item.requestId !== detail.requestId || keepGuids.has(item.guid))
  }

  private buildDetail(
    requestId: string,
    requestPath: string,
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
        return {
          guid,
          requestId,
          requestPath,
          type,
          success: httpResult.success,
          timestamp: now,
          pinned: false,
          requestMeta,
          response
        }
      }
      case 'graphql': {
        const gqlResult = result as GraphQLExecutionResult
        const response = this.buildGraphqlResponse(requestId, gqlResult)
        if (!response) return null
        return {
          guid,
          requestId,
          requestPath,
          type,
          success: gqlResult.success,
          timestamp: now,
          pinned: false,
          requestMeta,
          response
        }
      }
      case 'grpc': {
        const grpcResult = result as GRPCExecutionResult
        const response = this.buildGrpcResponse(requestId, grpcResult)
        if (!response) return null
        return {
          guid,
          requestId,
          requestPath,
          type,
          success: grpcResult.success,
          timestamp: now,
          pinned: false,
          requestMeta,
          response
        }
      }
      case 'soap': {
        const soapResult = result as SOAPExecutionResult
        const response = this.buildSoapResponse(requestId, soapResult)
        if (!response) return null
        return {
          guid,
          requestId,
          requestPath,
          type,
          success: soapResult.success,
          timestamp: now,
          pinned: false,
          requestMeta,
          response
        }
      }
      case 'websocket': {
        const wsResult = result as WebSocketExecutionResult
        const response = this.buildWebSocketResponse(requestId, wsResult)
        if (!response) return null
        return {
          guid,
          requestId,
          requestPath,
          type,
          success: wsResult.success,
          timestamp: now,
          pinned: false,
          requestMeta,
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

    const responseHeaders = this.headersRecordToKeyValues(result.headers)
    const contentTypeHeader = result.headers?.['content-type']
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    const contentLengthHeader = result.headers?.['content-length']
    const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined

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
      responseBody: result.body ?? '',
      ...(contentType ? { contentType } : {}),
      ...(contentLength !== undefined && !isNaN(contentLength) ? { contentLength } : {}),
      timings: result.timings,
      ...(result.error ? { error: result.error } : {})
    }
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

    return {
      type: 'grpc',
      requestUrl: resolvedUrl,
      requestMethod: result.requestMethod ?? '',
      requestMessage,
      requestMetadata,
      statusCode: result.statusCode ?? 12,
      statusMessage: result.statusMessage ?? '',
      responseMessage: result.responseMessage ?? '',
      responseMetadata: [],
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
      if (typeof parsed['requestPath'] !== 'string') return null
      if (typeof parsed['type'] !== 'string') return null
      if (typeof parsed['timestamp'] !== 'string') return null
      if (!this.isRecord(parsed['response'])) return null
      return parsed as ResponseHistoryDetail
    } catch {
      return null
    }
  }

  private parseHistoryIndex(text: string): ResponseHistoryIndex | null {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!this.isRecord(parsed)) return null
      if (!Array.isArray(parsed['entries'])) return null
      const maxPerRequest = parsed['maxPerRequest']
      const version = parsed['version']
      if (typeof maxPerRequest !== 'number' || typeof version !== 'number') return null
      return parsed as ResponseHistoryIndex
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

  private getArchivePath(): string | null {
    if (!isFileServiceInitialized()) return null
    const filePath = getFileService().getFilePath()
    if (!filePath) return null
    try {
      const isDirectory = existsSync(filePath) && statSync(filePath).isDirectory()
      if (isDirectory) {
        return join(filePath, 'responses.zip')
      }
      return `${filePath}.responses.zip`
    } catch {
      return `${filePath}.responses.zip`
    }
  }

  private getDetailEntryName(guid: string): string {
    return `${RESPONSES_FOLDER}/${guid}.json`
  }

  private async readArchive(archivePath: string): Promise<{ index: ResponseHistoryIndex; entriesData: Map<string, string> }> {
    if (!existsSync(archivePath)) {
      return {
        index: {
          version: 1,
          maxPerRequest: DEFAULT_MAX_PER_REQUEST,
          entries: []
        },
        entriesData: new Map()
      }
    }

    const buffer = await fs.readFile(archivePath)
    const reader = new ZipReader(new Uint8ArrayReader(buffer))
    const entries = await reader.getEntries() as { filename?: string; getData: (writer: TextWriter) => Promise<string> }[]
    const entriesData = new Map<string, string>()
    let index: ResponseHistoryIndex = {
      version: 1,
      maxPerRequest: DEFAULT_MAX_PER_REQUEST,
      entries: []
    }

    for (const entry of entries) {
      if (!entry.filename) continue
      const raw = await entry.getData(new TextWriter())
      const text = typeof raw === 'string' ? raw : ''
      entriesData.set(entry.filename, text)
      if (entry.filename === INDEX_FILE_NAME) {
        const parsed = this.parseHistoryIndex(text)
        if (parsed) {
          index = parsed
        } else {
          logger.warn('[ResponseHistoryService] Failed to parse index.json')
        }
      }
    }
    await reader.close()

    if (index.maxPerRequest <= 0) {
      index.maxPerRequest = DEFAULT_MAX_PER_REQUEST
    }

    return { index, entriesData }
  }

  private async writeArchive(
    archivePath: string,
    index: ResponseHistoryIndex,
    entriesData: Map<string, string>
  ): Promise<void> {
    const writer = new ZipWriter(new Uint8ArrayWriter())
    await writer.add(INDEX_FILE_NAME, new TextReader(JSON.stringify(index)))

    for (const [entryName, entryText] of entriesData.entries()) {
      if (entryName === INDEX_FILE_NAME) continue
      await writer.add(entryName, new TextReader(entryText))
    }

    const data = await writer.close()
    await fs.writeFile(archivePath, Buffer.from(data))
  }

  private async queueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn, fn)
    this.writeQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private getRequestPath(requestId: string): string | null {
    const collections = collectionStore.getCollections()
    if (collections.length === 0) return null

    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i]
      if (!collection) continue
      const base = this.folderSegment(collection.name, i, collections.length)
      const path = this.findRequestPathInItems(collection.items, base, requestId)
      if (path) return path
    }
    return null
  }

  private findRequestPathInItems(items: FolderItem[], prefix: string, requestId: string): string | null {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue
      if (isAnyFolder(item)) {
        const folderPrefix = `${prefix}/${this.folderSegment(item.name, i, items.length)}`
        const nested = this.findRequestPathInItems(item.items, folderPrefix, requestId)
        if (nested) return nested
      } else if (isRequest(item) && item.id === requestId) {
        return `${prefix}/${this.requestSegment(item as Record<string, unknown>, i, items.length)}`
      }
    }
    return null
  }

  private requestSegment(req: Record<string, unknown>, index0: number, count: number): string {
    const name = typeof req['name'] === 'string' ? req['name'] : ''
    const type = typeof req['type'] === 'string' ? req['type'] : ''

    let label = type.toUpperCase()
    if (type === 'http') {
      label = typeof req['method'] === 'string' ? req['method'] : 'HTTP'
    } else if (type === 'graphql') {
      label = 'GRAPHQL'
    } else if (type === 'grpc') {
      label = 'GRPC'
    } else if (type === 'soap') {
      label = 'SOAP'
    } else if (type === 'websocket') {
      label = 'WS'
    }

    return `${this.formatIndex(index0, count)} - ${label} - ${this.sanitizeName(name)}`
  }

  private folderSegment(name: string, index0: number, count: number): string {
    return `${this.formatIndex(index0, count)} - ${this.sanitizeName(name)}`
  }

  private formatIndex(index0: number, count: number): string {
    const width = count <= 0 ? 1 : String(count).length
    return String(index0 + 1).padStart(width, '0')
  }

  private sanitizeName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
  }
}

export const responseHistoryService = new ResponseHistoryService()

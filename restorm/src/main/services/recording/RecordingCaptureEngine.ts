/**
 * The capture engine of a recording session: listens to the network
 * traffic of ONE mini-browser web contents through the Chrome DevTools
 * Protocol (`webContents.debugger`, Network domain) and turns each
 * exchange into a stored call.
 *
 * Why CDP rather than `session.webRequest`: the debugger sees request AND
 * response bodies, WebSocket frames and gRPC-web trailers, and it is
 * scoped to the one web contents it is attached to — the rest of the
 * app's traffic is never observed (strict isolation).
 *
 * Flow per HTTP exchange: `requestWillBeSent` opens a pending entry
 * (redirects close the previous one as their own 30x call) →
 * `responseReceived` fills status/headers/mime → `loadingFinished` fetches
 * the body, classifies the protocol (http / graphql / grpc-web) and offers
 * the call to the store → `loadingFailed` stores the error instead.
 * WebSocket: one call per connection, frames appended as they flow.
 *
 * Page assets (scripts, styles, images, fonts, media, CORS preflights…)
 * are skipped at the door: a recording session is about API calls.
 *
 * Electron-agnostic on purpose: the IPC layer hands over the web contents
 * (and its debugger) behind the small `DebuggerLike` surface below, so the
 * engine unit-tests with a fake that replays CDP events.
 */

import type {
  CaptureBody,
  CaptureHeader,
  CaptureResourceType,
  RecordedCallDetail,
  RecordingFilterConfig,
  RecordingStatus
} from '../../../shared/types/recordingCapture'
import { classifyCapture, websocketMessageTypeOf } from '../../../shared/recording/classifyCapture'
import { recordingCaptureStore, type RecordingCaptureStore } from './RecordingCaptureStore'

// ---------------------------------------------------------------------------
// The slice of Electron the engine touches
// ---------------------------------------------------------------------------

export interface DebuggerLike {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown
  on(event: 'detach', listener: (event: unknown, reason: string) => void): unknown
  removeListener(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown
  removeListener(event: 'detach', listener: (event: unknown, reason: string) => void): unknown
}

export interface WebContentsLike {
  id: number
  debugger: DebuggerLike
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

export interface EngineLogger {
  warn(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------
// CDP payload shapes (the fields we read)
// ---------------------------------------------------------------------------

type CdpHeaders = Record<string, string>

interface CdpRequest {
  url: string
  method: string
  headers: CdpHeaders
  postData?: string
  hasPostData?: boolean
}

interface CdpResponse {
  url: string
  status: number
  statusText: string
  headers: CdpHeaders
  mimeType: string
  encodedDataLength?: number
}

interface RequestWillBeSentParams {
  requestId: string
  request: CdpRequest
  timestamp: number
  wallTime: number
  type?: string
  redirectResponse?: CdpResponse
}

interface PendingCall {
  requestId: string
  url: string
  method: string
  resourceType: CaptureResourceType
  /** Epoch ms. */
  startedAt: number
  /** CDP monotonic seconds, for the duration. */
  startTimestamp: number
  requestHeaders: CdpHeaders
  postData: string | null
  hasPostData: boolean
  response: CdpResponse | null
  responseHeaders: CdpHeaders
}

const SKIPPED_RESOURCE_TYPES = new Set([
  'script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'texttrack', 'prefetch', 'signedexchange', 'cspviolationreport', 'preflight'
])

const RESOURCE_TYPES: ReadonlySet<CaptureResourceType> = new Set<CaptureResourceType>([
  'document', 'xhr', 'fetch', 'websocket', 'eventsource', 'ping', 'other', 'script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'preflight'
])

export function resourceTypeOf(cdpType: string | undefined): CaptureResourceType {
  const lower = (cdpType ?? '').toLowerCase()
  return (RESOURCE_TYPES as ReadonlySet<string>).has(lower) ? (lower as CaptureResourceType) : lower === '' ? 'unknown' : 'other'
}

export function isSkippedResourceType(cdpType: string | undefined): boolean {
  return SKIPPED_RESOURCE_TYPES.has((cdpType ?? '').toLowerCase())
}

export function headersOf(headers: CdpHeaders | undefined): CaptureHeader[] {
  if (!headers) return []
  return Object.entries(headers).map(([key, value]) => ({ key, value }))
}

function mergeHeaders(base: CdpHeaders, extra: CdpHeaders | undefined): CdpHeaders {
  if (!extra) return base
  // Raw (ExtraInfo) headers carry what the wire saw — cookies, set-cookie
  // lines — and win over the possibly-synthetic first report.
  const overridden = new Set(Object.keys(extra).map((k) => k.toLowerCase()))
  const merged: CdpHeaders = Object.fromEntries(Object.entries(base).filter(([key]) => !overridden.has(key.toLowerCase())))
  for (const [key, value] of Object.entries(extra)) merged[key] = value
  return merged
}

export function queryOf(url: string): CaptureHeader[] {
  try {
    return [...new URL(url).searchParams.entries()].map(([key, value]) => ({ key, value }))
  } catch {
    return []
  }
}

function mimeOf(headers: CdpHeaders, fallback: string | null): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type') return value
  }
  return fallback
}

export function bodyOf(data: string, base64: boolean, mimeType: string | null): CaptureBody {
  const size = base64 ? Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) : Buffer.byteLength(data, 'utf8')
  return { encoding: base64 ? 'base64' : 'utf8', data, mimeType, size }
}

let captureCounter = 0
function newCaptureId(): string {
  captureCounter += 1
  return `cap-${Date.now().toString(36)}-${captureCounter.toString(36)}`
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Attachment {
  sessionId: string
  tabId: string
  webContents: WebContentsLike
  pending: Map<string, PendingCall>
  /** CDP requestId → stored capture id, for WebSocket connections. */
  sockets: Map<string, { captureId: string; url: string }>
  onMessage: (event: unknown, method: string, params: unknown) => void
  onDetach: (event: unknown, reason: string) => void
  onDestroyed: () => void
}

export class RecordingCaptureEngine {
  private readonly attachments = new Map<string, Attachment>()

  constructor(
    private readonly store: RecordingCaptureStore = recordingCaptureStore,
    private readonly logger: EngineLogger = { warn: () => undefined, debug: () => undefined }
  ) {}

  /** Start recording `sessionId` on the given mini-browser web contents. */
  async start(sessionId: string, tabId: string, webContents: WebContentsLike, url: string, config: RecordingFilterConfig): Promise<RecordingStatus> {
    if (this.attachments.has(sessionId)) this.stop(sessionId)
    const dbg = webContents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    const attachment: Attachment = {
      sessionId,
      tabId,
      webContents,
      pending: new Map(),
      sockets: new Map(),
      onMessage: (_event, method, params) => { this.handleMessage(attachment, method, params) },
      onDetach: (_event, reason) => {
        this.logger.warn('[RecordingCaptureEngine] debugger detached', { sessionId, reason })
        this.teardown(attachment, false)
      },
      onDestroyed: () => { this.teardown(attachment, false) }
    }
    dbg.on('message', attachment.onMessage)
    dbg.on('detach', attachment.onDetach)
    webContents.once('destroyed', attachment.onDestroyed)
    this.attachments.set(sessionId, attachment)
    this.store.startRun(sessionId, url, tabId, config)
    try {
      await dbg.sendCommand('Network.enable', { maxTotalBufferSize: 200 * 1024 * 1024, maxResourceBufferSize: 50 * 1024 * 1024 })
    } catch (error) {
      this.logger.warn('[RecordingCaptureEngine] Network.enable failed', { sessionId, error: String(error) })
      this.teardown(attachment, true)
      throw error
    }
    return this.store.status(sessionId)
  }

  stop(sessionId: string): RecordingStatus {
    const attachment = this.attachments.get(sessionId)
    if (attachment) this.teardown(attachment, true)
    else this.store.endRun(sessionId)
    return this.store.status(sessionId)
  }

  pause(sessionId: string): RecordingStatus {
    this.store.setPaused(sessionId, true)
    return this.store.status(sessionId)
  }

  resume(sessionId: string): RecordingStatus {
    this.store.setPaused(sessionId, false)
    return this.store.status(sessionId)
  }

  isRecording(sessionId: string): boolean {
    return this.attachments.has(sessionId)
  }

  /** The session currently recording on a mini-browser tab, if any. */
  sessionForTab(tabId: string): string | null {
    for (const attachment of this.attachments.values()) {
      if (attachment.tabId === tabId) return attachment.sessionId
    }
    return null
  }

  stopAll(): void {
    for (const sessionId of [...this.attachments.keys()]) this.stop(sessionId)
  }

  private teardown(attachment: Attachment, detachDebugger: boolean): void {
    if (this.attachments.get(attachment.sessionId) !== attachment) return
    this.attachments.delete(attachment.sessionId)
    const { webContents } = attachment
    const dbg = webContents.debugger
    dbg.removeListener('message', attachment.onMessage)
    dbg.removeListener('detach', attachment.onDetach)
    webContents.removeListener('destroyed', attachment.onDestroyed)
    if (detachDebugger && !webContents.isDestroyed()) {
      try {
        if (dbg.isAttached()) dbg.detach()
      } catch (error) {
        this.logger.warn('[RecordingCaptureEngine] debugger detach failed', { sessionId: attachment.sessionId, error: String(error) })
      }
    }
    attachment.pending.clear()
    attachment.sockets.clear()
    this.store.endRun(attachment.sessionId)
  }

  // ---------------------------------------------------------------------
  // CDP events
  // ---------------------------------------------------------------------

  private handleMessage(attachment: Attachment, method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case 'Network.requestWillBeSent': this.onRequestWillBeSent(attachment, p as unknown as RequestWillBeSentParams); break
      case 'Network.requestWillBeSentExtraInfo': this.onRequestExtraInfo(attachment, p); break
      case 'Network.responseReceived': this.onResponseReceived(attachment, p); break
      case 'Network.responseReceivedExtraInfo': this.onResponseExtraInfo(attachment, p); break
      case 'Network.loadingFinished': void this.onLoadingFinished(attachment, p); break
      case 'Network.loadingFailed': this.onLoadingFailed(attachment, p); break
      case 'Network.webSocketCreated': this.onWebSocketCreated(attachment, p); break
      case 'Network.webSocketWillSendHandshakeRequest': this.onWebSocketHandshakeRequest(attachment, p); break
      case 'Network.webSocketHandshakeResponseReceived': this.onWebSocketHandshakeResponse(attachment, p); break
      case 'Network.webSocketFrameSent': this.onWebSocketFrame(attachment, p, 'sent'); break
      case 'Network.webSocketFrameReceived': this.onWebSocketFrame(attachment, p, 'received'); break
      case 'Network.webSocketClosed': this.onWebSocketClosed(attachment, p); break
      default: break
    }
  }

  private onRequestWillBeSent(attachment: Attachment, params: RequestWillBeSentParams): void {
    const previous = attachment.pending.get(params.requestId)
    if (previous && params.redirectResponse) {
      // The redirect is a complete exchange of its own (a 30x with headers,
      // no body): store it, then track the follow-up request under the same id.
      previous.response = params.redirectResponse
      previous.responseHeaders = mergeHeaders(params.redirectResponse.headers, previous.responseHeaders)
      this.finalize(attachment, previous, null, params.timestamp, null)
    }
    if (isSkippedResourceType(params.type)) {
      attachment.pending.delete(params.requestId)
      return
    }
    attachment.pending.set(params.requestId, {
      requestId: params.requestId,
      url: params.request.url,
      method: (params.request.method || 'GET').toUpperCase(),
      resourceType: resourceTypeOf(params.type),
      startedAt: Math.round(params.wallTime * 1000),
      startTimestamp: params.timestamp,
      requestHeaders: { ...params.request.headers },
      postData: params.request.postData ?? null,
      hasPostData: params.request.hasPostData === true || params.request.postData !== undefined,
      response: null,
      responseHeaders: {}
    })
  }

  private onRequestExtraInfo(attachment: Attachment, params: Record<string, unknown>): void {
    const pending = attachment.pending.get(String(params['requestId']))
    if (!pending) return
    pending.requestHeaders = mergeHeaders(pending.requestHeaders, params['headers'] as CdpHeaders | undefined)
  }

  private onResponseReceived(attachment: Attachment, params: Record<string, unknown>): void {
    const pending = attachment.pending.get(String(params['requestId']))
    if (!pending) return
    const response = params['response'] as CdpResponse | undefined
    if (!response) return
    pending.response = response
    pending.responseHeaders = mergeHeaders(response.headers, pending.responseHeaders)
    if (typeof params['type'] === 'string' && pending.resourceType === 'unknown') pending.resourceType = resourceTypeOf(params['type'])
  }

  private onResponseExtraInfo(attachment: Attachment, params: Record<string, unknown>): void {
    const pending = attachment.pending.get(String(params['requestId']))
    if (!pending) return
    pending.responseHeaders = mergeHeaders(pending.responseHeaders, params['headers'] as CdpHeaders | undefined)
  }

  private async onLoadingFinished(attachment: Attachment, params: Record<string, unknown>): Promise<void> {
    const requestId = String(params['requestId'])
    const pending = attachment.pending.get(requestId)
    if (!pending) return
    attachment.pending.delete(requestId)
    const finishedAt = typeof params['timestamp'] === 'number' ? params['timestamp'] : pending.startTimestamp
    const encodedSize = typeof params['encodedDataLength'] === 'number' ? params['encodedDataLength'] : null

    // Cheap pre-check before fetching bodies: a filtered-out url (assets
    // through the black list, another host through the white list) must
    // not cost a getResponseBody round-trip. `http` is the widest gate — a
    // call that turns out to be graphql/grpc-web is re-checked at offer time.
    if (!this.store.wouldAccept(attachment.sessionId, 'http', pending.url) &&
        !this.store.wouldAccept(attachment.sessionId, 'graphql', pending.url) &&
        !this.store.wouldAccept(attachment.sessionId, 'grpc-web', pending.url)) return

    const dbg = attachment.webContents.debugger
    let requestBody: string | null = pending.postData
    if (requestBody === null && pending.hasPostData) {
      try {
        const result = await dbg.sendCommand('Network.getRequestPostData', { requestId }) as { postData?: string }
        requestBody = result.postData ?? null
      } catch {
        requestBody = null
      }
    }
    let responseBody: { body: string; base64Encoded: boolean } | null = null
    if (pending.response && pending.response.status !== 204 && pending.response.status !== 304) {
      try {
        responseBody = await dbg.sendCommand('Network.getResponseBody', { requestId }) as { body: string; base64Encoded: boolean }
      } catch {
        responseBody = null
      }
    }
    if (!this.attachments.has(attachment.sessionId)) return
    this.finalize(attachment, pending, requestBody, finishedAt, responseBody, encodedSize)
  }

  private onLoadingFailed(attachment: Attachment, params: Record<string, unknown>): void {
    const requestId = String(params['requestId'])
    const pending = attachment.pending.get(requestId)
    if (!pending) return
    attachment.pending.delete(requestId)
    const finishedAt = typeof params['timestamp'] === 'number' ? params['timestamp'] : pending.startTimestamp
    const errorText = typeof params['errorText'] === 'string' ? params['errorText'] : 'failed'
    const canceled = params['canceled'] === true
    this.finalize(attachment, pending, pending.postData, finishedAt, null, null, canceled ? `canceled (${errorText})` : errorText)
  }

  private finalize(
    attachment: Attachment,
    pending: PendingCall,
    requestBodyText: string | null,
    finishedAt: number,
    responseBody: { body: string; base64Encoded: boolean } | null,
    encodedSize: number | null = null,
    error?: string
  ): void {
    const requestHeaders = headersOf(pending.requestHeaders)
    const responseHeaders = headersOf(pending.responseHeaders)
    const responseMime = pending.response ? mimeOf(pending.responseHeaders, pending.response.mimeType || null) : null
    const classification = classifyCapture({
      method: pending.method,
      url: pending.url,
      requestHeaders,
      requestBodyText,
      responseMimeType: responseMime,
      responseHeaders
    })
    const requestMime = mimeOf(pending.requestHeaders, null)
    const detail: RecordedCallDetail = {
      id: newCaptureId(),
      sessionId: attachment.sessionId,
      runId: '',
      protocol: classification.protocol,
      timestamp: pending.startedAt,
      method: pending.method,
      url: pending.url,
      resourceType: pending.resourceType,
      durationMs: Math.max(0, Math.round((finishedAt - pending.startTimestamp) * 1000)),
      ...(pending.response ? { status: pending.response.status, statusText: pending.response.statusText } : {}),
      ...(responseMime !== null ? { mimeType: responseMime } : {}),
      ...(encodedSize !== null ? { responseSize: encodedSize } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(classification.graphql ? { graphql: classification.graphql } : {}),
      ...(classification.grpc ? { grpc: classification.grpc } : {}),
      request: {
        headers: requestHeaders,
        query: queryOf(pending.url),
        body: requestBodyText !== null ? bodyOf(requestBodyText, false, requestMime) : null
      },
      response: pending.response
        ? { headers: responseHeaders, body: responseBody ? bodyOf(responseBody.body, responseBody.base64Encoded, responseMime) : null }
        : null
    }
    this.store.offer(detail)
  }

  // ---------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------

  private onWebSocketCreated(attachment: Attachment, params: Record<string, unknown>): void {
    const requestId = String(params['requestId'])
    const url = typeof params['url'] === 'string' ? params['url'] : ''
    if (!this.store.wouldAccept(attachment.sessionId, 'websocket', url)) return
    const detail: RecordedCallDetail = {
      id: newCaptureId(),
      sessionId: attachment.sessionId,
      runId: '',
      protocol: 'websocket',
      timestamp: Date.now(),
      method: 'WS',
      url,
      resourceType: 'websocket',
      websocket: { messageType: null, messageTypes: [], frameCount: 0, closed: false },
      request: { headers: [], query: queryOf(url), body: null },
      response: null,
      websocketFrames: []
    }
    if (this.store.offer(detail)) attachment.sockets.set(requestId, { captureId: detail.id, url })
  }

  private onWebSocketHandshakeRequest(attachment: Attachment, params: Record<string, unknown>): void {
    const socket = attachment.sockets.get(String(params['requestId']))
    if (!socket) return
    const request = params['request'] as { headers?: CdpHeaders } | undefined
    this.store.update(attachment.sessionId, socket.captureId, (call) => {
      call.request.headers = headersOf(request?.headers)
    })
  }

  private onWebSocketHandshakeResponse(attachment: Attachment, params: Record<string, unknown>): void {
    const socket = attachment.sockets.get(String(params['requestId']))
    if (!socket) return
    const response = params['response'] as { status?: number; statusText?: string; headers?: CdpHeaders } | undefined
    this.store.update(attachment.sessionId, socket.captureId, (call) => {
      if (response?.status !== undefined) call.status = response.status
      if (response?.statusText !== undefined) call.statusText = response.statusText
      call.response = { headers: headersOf(response?.headers), body: null }
    })
  }

  private onWebSocketFrame(attachment: Attachment, params: Record<string, unknown>, direction: 'sent' | 'received'): void {
    const socket = attachment.sockets.get(String(params['requestId']))
    if (!socket) return
    const frame = params['response'] as { opcode?: number; payloadData?: string } | undefined
    const opcode = frame?.opcode ?? 1
    const payload = frame?.payloadData ?? ''
    const timestamp = Date.now()
    const messageType = opcode === 1 ? websocketMessageTypeOf(payload) : null
    this.store.update(attachment.sessionId, socket.captureId, (call) => {
      call.websocketFrames ??= []
      call.websocketFrames.push({ direction, timestamp, opcode, payload })
      call.websocket ??= { messageType: null, messageTypes: [], frameCount: 0, closed: false }
      const ws = call.websocket
      ws.frameCount = call.websocketFrames.length
      if (messageType !== null) {
        ws.messageType ??= messageType
        if (!ws.messageTypes.includes(messageType)) ws.messageTypes.push(messageType)
      }
    })
  }

  private onWebSocketClosed(attachment: Attachment, params: Record<string, unknown>): void {
    const requestId = String(params['requestId'])
    const socket = attachment.sockets.get(requestId)
    if (!socket) return
    attachment.sockets.delete(requestId)
    this.store.update(attachment.sessionId, socket.captureId, (call) => {
      if (call.websocket) call.websocket.closed = true
    })
  }
}

export const recordingCaptureEngine = new RecordingCaptureEngine()

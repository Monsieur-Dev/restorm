/**
 * SSE (Server-Sent Events) Execution Service
 *
 * A dedicated, receive-only streaming protocol: unlike WebSocket / Socket.IO /
 * MQTT (`WebSocketExecutionService`), SSE is a plain long-lived HTTP GET whose
 * response body is progressively parsed as `text/event-stream` frames — so it
 * uses Node's raw `http`/`https` client (NOT `fetch`, which buffers the whole
 * body before resolving) rather than a socket library. There is no send
 * direction and no server mode; the connection is purely a client subscribing
 * to a stream.
 */

import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BrowserWindow } from 'electron'
import { logger, withFirewallBypassSync } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../shared/config/constants'

/** Default delay (ms) before an automatic reconnect when the stream drops and
 * the server never sent a `retry:` hint — mirrors the EventSource spec's
 * commonly-implemented 3s default. */
const DEFAULT_RECONNECT_DELAY_MS = 3000

/**
 * Lifetime cap on automatic reconnect attempts for a streaming SSE connection.
 * A server that never comes back up (or drops again immediately) must not
 * retry forever — mirrors `MQTT_MAX_RECONNECT_ATTEMPTS` in
 * `WebSocketExecutionService`.
 */
const SSE_MAX_RECONNECT_ATTEMPTS = 10

/** One parsed SSE frame, timestamped when it was received. */
export interface SseMessage {
  event: string
  data: string
  id?: string
  timestamp: string
}

export interface SseExecutionInput {
  requestId: string
  timeout?: number
}

export interface SseExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  frames: SseMessage[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

interface ActiveSseConnection {
  requestId: string
  abort: () => void
  startTime: number
  frames: SseMessage[]
}

interface ResolvedSseExecution {
  requestId: string
  timeout: number
  startTime: number
  startedAt: string
  resolvedUrl: string
  headers: Record<string, string>
  lastEventId: string | undefined
}

/**
 * Parses the `text/event-stream` wire format per the W3C EventSource spec:
 * `event:` / `data:` / `id:` / `retry:` fields, `:`-prefixed comments,
 * multi-line `data:` blocks (joined with `\n`, trailing `\n` trimmed), and
 * blank-line dispatch. A field with no value dispatches an empty-string
 * value (an empty `data:` line still produces a frame with `data: ''`).
 *
 * Exported standalone (no service instance required) so the parsing logic is
 * unit-testable in isolation from the streaming HTTP plumbing — the actual
 * network chunk boundaries are irrelevant to the wire-format state machine,
 * including a `\r\n` line terminator split across two `feed()` calls.
 */
export class SseFrameParser {
  private buffer = ''
  private dataBuffer = ''
  private eventTypeBuffer = ''
  private lastEventId: string
  private retry: number | undefined
  /** Set when the previous `feed()` call ended right after a bare `\r` that
   * might be the first half of a `\r\n` split across two network chunks. The
   * `\r` is dispatched as a terminator immediately (it's already valid on
   * its own) — this flag only tells the next call to swallow a leading `\n`
   * so it isn't mistaken for a second, empty line. */
  private pendingCR = false

  constructor(initialLastEventId = '') {
    this.lastEventId = initialLastEventId
  }

  /** The last non-NUL `id:` value seen — the spec never resets this between
   * dispatches, so it seeds the `Last-Event-ID` header on reconnect. */
  getLastEventId(): string {
    return this.lastEventId
  }

  /** The most recently seen `retry:` hint (milliseconds). Consumed once by the
   * caller (the reconnect delay) — reading it clears it so a stale hint from
   * several frames ago doesn't linger. */
  takeRetry(): number | undefined {
    const value = this.retry
    this.retry = undefined
    return value
  }

  /**
   * Feed a raw chunk of decoded text. Returns every frame completed by a
   * blank-line dispatch within this chunk; an incomplete trailing line is
   * buffered for the next call.
   */
  feed(rawChunk: string): { event: string; data: string; id?: string }[] {
    let chunk = rawChunk
    if (this.pendingCR) {
      this.pendingCR = false
      if (chunk.startsWith('\n')) chunk = chunk.slice(1)
    }
    this.buffer += chunk
    const frames: { event: string; data: string; id?: string }[] = []
    let lineStart = 0
    for (;;) {
      let lineEnd = -1
      let terminatorLen = 0
      for (let i = lineStart; i < this.buffer.length; i++) {
        const ch = this.buffer[i]
        if (ch === '\n') {
          lineEnd = i
          terminatorLen = 1
          break
        }
        if (ch === '\r') {
          // A `\r` as the very last buffered byte MIGHT be the first half of
          // a `\r\n` terminator split across two network chunks — but it is
          // already a valid terminator on its own, so dispatch the line now
          // rather than withholding it (a stream that ends right here must
          // still flush). `pendingCR` tells the next feed() to swallow a
          // leading `\n` so the split `\r\n` isn't double-counted.
          if (i === this.buffer.length - 1) {
            lineEnd = i
            terminatorLen = 1
            this.pendingCR = true
            break
          }
          terminatorLen = this.buffer[i + 1] === '\n' ? 2 : 1
          lineEnd = i
          break
        }
      }
      if (lineEnd === -1) break
      this.processLine(this.buffer.slice(lineStart, lineEnd), frames)
      lineStart = lineEnd + terminatorLen
    }
    this.buffer = this.buffer.slice(lineStart)
    return frames
  }

  private processLine(line: string, frames: { event: string; data: string; id?: string }[]): void {
    if (line === '') {
      this.dispatch(frames)
      return
    }
    if (line.startsWith(':')) return // comment line, ignored

    const colon = line.indexOf(':')
    let field: string
    let value: string
    if (colon === -1) {
      field = line
      value = ''
    } else {
      field = line.slice(0, colon)
      value = line.slice(colon + 1)
      // Exactly one leading space after the colon is stripped, per spec.
      if (value.startsWith(' ')) value = value.slice(1)
    }

    switch (field) {
      case 'event':
        this.eventTypeBuffer = value
        break
      case 'data':
        this.dataBuffer += `${value}\n`
        break
      case 'id':
        // A NUL byte in the id value means "ignore this field" per spec.
        if (!value.includes('\u0000')) this.lastEventId = value
        break
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number.parseInt(value, 10)
        break
      default:
        break // unknown field, ignored
    }
  }

  private dispatch(frames: { event: string; data: string; id?: string }[]): void {
    if (this.dataBuffer === '') {
      // No `data:` field was seen since the last dispatch — per spec, an
      // event-less blank line resets the event-type buffer and dispatches
      // nothing.
      this.eventTypeBuffer = ''
      return
    }
    let data = this.dataBuffer
    if (data.endsWith('\n')) data = data.slice(0, -1)
    frames.push({
      event: this.eventTypeBuffer || 'message',
      data,
      ...(this.lastEventId ? { id: this.lastEventId } : {})
    })
    this.dataBuffer = ''
    this.eventTypeBuffer = ''
  }
}

/**
 * Service for executing Server-Sent Events requests in the main process.
 */
class SseExecutionService {
  private activeConnections = new Map<string, ActiveSseConnection>()

  /**
   * Connect and stream until the connection is explicitly disconnected, the
   * server ends the stream after exhausting the reconnect budget, or an
   * unrecoverable error occurs. Resolves once the run is truly over — the
   * request-panel Connect button awaits this the same way
   * `WebSocketExecutionService.execute` does.
   */
  async execute(input: SseExecutionInput): Promise<SseExecutionResult> {
    const { requestId, timeout = DEFAULT_REQUEST_TIMEOUT_MS } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    let resolved: ResolvedSseExecution
    try {
      resolved = await this.resolveExecution(requestId, timeout)
    } catch (err) {
      return {
        requestId,
        success: false,
        connected: false,
        frames: [],
        error: (err as Error).message,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    return new Promise((resolve) => {
      let connectedOnce = false
      const frames: SseMessage[] = []
      const controller = this.startStream(resolved, {
        onConnect: () => { connectedOnce = true },
        onFrame: (frame) => {
          frames.push(frame)
          this.broadcastMessage(requestId, frame)
        },
        onClose: (error) => {
          this.activeConnections.delete(requestId)
          this.broadcastProgress(requestId, error ? 'error' : 'completed')
          const result: SseExecutionResult = {
            requestId,
            success: connectedOnce && error === undefined,
            connected: connectedOnce,
            frames,
            ...(error !== undefined ? { error } : {}),
            requestUrl: resolved.resolvedUrl,
            timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
          }
          this.persistHistory(requestId, result)
          resolve(result)
        }
      })
      this.activeConnections.set(requestId, { requestId, abort: controller.close, startTime: resolved.startTime, frames })
      this.broadcastProgress(requestId, 'started')
    })
  }

  /**
   * Streaming counterpart for the scenario engine's `sseConnect` node —
   * mirrors {@link WebSocketExecutionService.connectStreamingRaw}'s callback
   * shape so the scheduler's connect-bridge dispatch works unchanged. Unlike
   * WebSocket, SSE has no send direction, so the returned controller carries
   * only `close`/`isOpen`.
   */
  connectStreamingSse(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    // Stop-during-resolve guard: a `.close()` call arriving while
    // `resolveExecution` is still awaiting must be detectable once the await
    // resumes. Held on a mutable object (not a bare `let`) and read through a
    // function so flow analysis doesn't narrow it to `false` across the
    // `await` — mirrors the `closedByCaller` / `cancel.stopped` guards in
    // `WebSocketExecutionService`'s streaming twins.
    const ctl = { closedByCaller: false }
    const wasClosed = (): boolean => ctl.closedByCaller
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      input.onClose(error)
    }

    void (async () => {
      let resolved: ResolvedSseExecution
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (wasClosed()) { fireClose(); return }

      const frames: SseMessage[] = []
      const controller = this.startStream(resolved, {
        onConnect: () => { input.onConnect() },
        onFrame: (frame) => {
          frames.push(frame)
          this.broadcastMessage(requestId, frame)
          let parsed: unknown
          try { parsed = JSON.parse(frame.data) } catch { parsed = frame.data }
          input.onMessage(frame.event, parsed)
        },
        onClose: (error) => {
          this.activeConnections.delete(requestId)
          this.broadcastProgress(requestId, error ? 'error' : 'completed')
          this.persistHistory(requestId, {
            requestId,
            success: error === undefined,
            connected: frames.length > 0 || error === undefined,
            frames,
            ...(error !== undefined ? { error } : {}),
            requestUrl: resolved.resolvedUrl,
            timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
          })
          fireClose(error)
        }
      })
      this.activeConnections.set(requestId, { requestId, abort: controller.close, startTime: resolved.startTime, frames })
      this.broadcastProgress(requestId, 'started')
    })()

    return {
      close: () => { ctl.closedByCaller = true; this.disconnect(requestId) },
      isOpen: () => this.isActive(requestId)
    }
  }

  /**
   * The reconnecting stream engine shared by {@link execute} and
   * {@link connectStreamingSse}: opens the GET, parses frames as they arrive,
   * and on a drop schedules a reconnect (seeded with the last received
   * `id:` via `Last-Event-ID`, per spec) until `closedByCaller` or the
   * reconnect budget is exhausted.
   */
  private startStream(
    resolved: ResolvedSseExecution,
    callbacks: {
      onConnect: () => void
      onFrame: (frame: SseMessage) => void
      onClose: (error?: string) => void
    }
  ): { close: () => void } {
    let closedByCaller = false
    let request: http.ClientRequest | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectAttempts = 0
    let lastEventId = resolved.lastEventId
    let everConnected = false

    const scheduleReconnect = (delayMs: number): void => {
      reconnectAttempts += 1
      if (reconnectAttempts > SSE_MAX_RECONNECT_ATTEMPTS) {
        callbacks.onClose(`Gave up reconnecting after ${SSE_MAX_RECONNECT_ATTEMPTS} attempts`)
        return
      }
      reconnectTimer = setTimeout(connect, delayMs)
    }

    const connect = (): void => {
      if (closedByCaller) return
      const headers: Record<string, string> = {
        ...resolved.headers,
        Accept: resolved.headers['Accept'] ?? resolved.headers['accept'] ?? 'text/event-stream'
      }
      if (lastEventId) headers['Last-Event-ID'] = lastEventId

      let url: URL
      try {
        url = new URL(resolved.resolvedUrl)
      } catch (err) {
        callbacks.onClose((err as Error).message || 'Invalid URL')
        return
      }
      const isHttps = url.protocol === 'https:'
      const httpModule = isHttps ? https : http
      const parser = new SseFrameParser(lastEventId ?? '')
      // Bound only the INITIAL connect (time to receive response headers) —
      // once streaming, idle gaps between frames (heartbeats, quiet periods)
      // must never be mistaken for a stalled connection.
      let connectTimedOut = false
      const connectTimer = setTimeout(() => {
        connectTimedOut = true
        request?.destroy()
      }, resolved.timeout)

      request = withFirewallBypassSync(() => httpModule.request(url, { method: 'GET', headers }))
      request.on('response', (response: IncomingMessage) => {
        clearTimeout(connectTimer)
        const status = response.statusCode ?? 0
        if (status === 204) {
          // Per spec: 204 No Content means "stop reconnecting".
          response.resume()
          callbacks.onClose(everConnected ? undefined : 'Server returned 204 — no more events')
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          const message = `Unexpected HTTP status ${status}${response.statusMessage ? ` ${response.statusMessage}` : ''}`
          scheduleReconnect(DEFAULT_RECONNECT_DELAY_MS)
          logger.warn('[SseExecutionService] Non-2xx response, will retry', { status, message })
          return
        }
        // A reconnect re-establishes the SAME logical session, so the
        // UI/scenario `connected` signal fires only on the FIRST successful
        // connect, not on every reconnect.
        const isFirstConnect = !everConnected
        everConnected = true
        reconnectAttempts = 0
        if (isFirstConnect) callbacks.onConnect()
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          const frames = parser.feed(chunk)
          for (const f of frames) {
            if (f.id) lastEventId = f.id
            callbacks.onFrame({ ...f, timestamp: new Date().toISOString() })
          }
        })
        response.on('end', () => {
          if (closedByCaller) return
          const retryDelay = parser.takeRetry() ?? DEFAULT_RECONNECT_DELAY_MS
          scheduleReconnect(retryDelay)
        })
        response.on('error', (err: Error) => {
          if (closedByCaller) return
          logger.warn('[SseExecutionService] Response stream error, will retry', { error: err.message })
          scheduleReconnect(DEFAULT_RECONNECT_DELAY_MS)
        })
      })
      request.on('error', (err: Error) => {
        clearTimeout(connectTimer)
        if (closedByCaller) return
        if (connectTimedOut) {
          callbacks.onClose(`Connection timed out after ${resolved.timeout}ms`)
          return
        }
        // Connect failures (DNS, ECONNREFUSED, …) are retried through the
        // same bounded budget as a mid-stream drop — a server that is merely
        // slow to come up (or briefly flaky) still gets a handful of
        // attempts before the run is reported as failed.
        logger.warn('[SseExecutionService] Connection error, will retry', { error: err.message })
        scheduleReconnect(DEFAULT_RECONNECT_DELAY_MS)
      })
      request.end()
    }

    connect()

    return {
      // A caller-initiated close (Disconnect / Stop) is always a clean end,
      // whether or not the stream ever connected.
      close: () => {
        closedByCaller = true
        if (reconnectTimer) clearTimeout(reconnectTimer)
        request?.destroy()
        callbacks.onClose()
      }
    }
  }

  /**
   * Resolve the request's URL / headers / `Last-Event-ID` seed, hydrating any
   * secrets reachable from its KeyValue groups first — mirrors
   * `WebSocketExecutionService.resolveExecution`.
   */
  private async resolveExecution(requestId: string, timeout: number): Promise<ResolvedSseExecution> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      throw new Error('No resolved URL found for this request. Make sure the request is registered.')
    }
    let resolvedUrl = urlResult.resolvedUrl

    const requestContext = contextService.getRequestContext(requestId)

    const envSecrets = contextService.collectEnvironmentSecrets(requestId)
    const secrets = [...collectRequestSecrets(requestContext?.keyValueGroups), ...envSecrets]
    if (secrets.length > 0) {
      await secretHydrationService.hydrate(requestId, secrets)
      if (envSecrets.length > 0) {
        contextService.refreshEnvironmentContext(requestId)
        resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? resolvedUrl
      }
    }

    const headers: Record<string, string> = {}
    const headersGroup = requestContext?.keyValueGroups.get('headers')
    if (headersGroup) {
      for (const h of headersGroup) {
        if (h.enabled === false) continue
        if (h.key) {
          // The KEY resolves unconditionally through Handlebars, same as a
          // path/query param key or the URL — a header name has no ValueType
          // to gate on. The VALUE stays type-aware: only `ExpressionValue`
          // rows get substituted, a `StringValue` row ships verbatim. See
          // `HTTPExecutionService`.
          const resolvedKey = contextService.resolveValue(h.key, requestId)
          headers[resolvedKey] = contextService.resolveKeyValueForRequest(h, requestId)
        }
      }
    }

    const rawLastEventId = requestContext?.fullData?.lastEventId
    const lastEventId = typeof rawLastEventId === 'string' && rawLastEventId.length > 0
      ? contextService.resolveValue(rawLastEventId, requestId)
      : undefined

    return { requestId, timeout, startTime, startedAt, resolvedUrl, headers, lastEventId }
  }

  /** Disconnect an active connection. Returns whether anything was actually
   * connected (safe to call when nothing is in flight). */
  disconnect(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return false
    logger.info('[SseExecutionService] Disconnecting', { requestId })
    connection.abort()
    this.activeConnections.delete(requestId)
    return true
  }

  /** Tear down every active connection — called when the open project closes
   * or the app quits, mirroring `WebSocketExecutionService.closeAll`. */
  closeAll(): void {
    const count = this.activeConnections.size
    for (const requestId of [...this.activeConnections.keys()]) {
      try { this.disconnect(requestId) } catch { /* best-effort teardown */ }
    }
    if (count > 0) logger.info('[SseExecutionService] Closed all connections', { count })
  }

  /** Check if a connection is currently active. */
  isActive(requestId: string): boolean {
    return this.activeConnections.has(requestId)
  }

  /**
   * Snapshot the frame buffer for an active connection. Mirrors
   * `WebSocketExecutionService.getMessages` — used by the MCP `read_stream`
   * tool. Returns `null` when the connection is no longer tracked.
   */
  getMessages(requestId: string, afterIndex = 0): { frames: SseMessage[]; total: number } | null {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return null
    const total = connection.frames.length
    const start = Math.max(0, Math.min(afterIndex, total))
    return { frames: connection.frames.slice(start), total }
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('sse:connection-progress', { requestId, status })
    }
  }

  private broadcastMessage(requestId: string, message: SseMessage): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('sse:message', { requestId, message })
    }
  }

  /** Persist a finished session to the response history (fire-and-forget) so
   * the response panel + a scenario `sseConnect` node's preview can read the
   * received frames later. Failures are swallowed: history is best-effort. */
  private persistHistory(requestId: string, result: SseExecutionResult): void {
    void responseHistoryService.storeExecutionResult(requestId, 'sse', result).catch(() => {
      // best-effort; a history write must never surface as a connection error
    })
  }
}

/** Singleton instance */
export const sseExecutionService = new SseExecutionService()

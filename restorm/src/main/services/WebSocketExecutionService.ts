/**
 * WebSocket Execution Service
 * Handles WebSocket and Socket.IO connections in the main process with
 * streaming support. The wire transport is chosen from the request's
 * `protocol` field: `websocket` uses the raw `ws` client, `socketio` uses
 * `socket.io-client`. Both share the same IPC surface, message model, and
 * active-connection registry.
 */

import WebSocket from 'ws'
import { io, type Socket } from 'socket.io-client'
import { BrowserWindow } from 'electron'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_WS_TIMEOUT_MS } from '../../shared/config/constants'

/** WebSocket request execution input */
export interface WebSocketExecutionInput {
  requestId: string
  timeout?: number
}

/** WebSocket message */
export interface WebSocketMessage {
  direction: 'sent' | 'received'
  data: string
  event?: string
  timestamp: string
}

/** WebSocket response result */
export interface WebSocketExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  messages: WebSocketMessage[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** Active connection info — holds either a raw WS or a Socket.IO client. */
interface ActiveConnection {
  requestId: string
  kind: 'websocket' | 'socketio'
  ws?: WebSocket
  socket?: Socket
  startTime: number
  messages: WebSocketMessage[]
}

/** Resolved inputs shared by both transport paths. */
interface ResolvedExecution {
  requestId: string
  timeout: number
  startTime: number
  startedAt: string
  resolvedUrl: string
  headers: Record<string, string>
  resolvedMessage: string
  event: string | undefined
  /** Wire transport: `socketio` | `websocket` (from `fullData.protocol`). */
  protocol: string | undefined
}

/** Serialize an arbitrary Socket.IO payload to the string message model. */
function stringifyPayload(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('base64')
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable payload]'
  }
}

/** Parse a user-typed message into a JSON value, falling back to the raw string. */
function parsePayload(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

/**
 * Service for executing WebSocket / Socket.IO requests in the main process
 */
class WebSocketExecutionService {
  private activeConnections = new Map<string, ActiveConnection>()

  /**
   * Resolve the request, hydrate secrets, then dispatch to the transport
   * matching the request's `protocol`.
   */
  async execute(input: WebSocketExecutionInput): Promise<WebSocketExecutionResult> {
    const { requestId, timeout = DEFAULT_WS_TIMEOUT_MS } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    let resolved: ResolvedExecution
    try {
      resolved = await this.resolveExecution(requestId, timeout)
    } catch (err) {
      return {
        requestId,
        success: false,
        connected: false,
        messages: [],
        error: (err as Error).message,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    // Broadcast that connection started
    this.broadcastProgress(requestId, 'started')

    if (resolved.protocol === 'socketio') {
      logger.info('[WebSocketExecutionService] Connecting (socket.io)', { requestId, url: resolved.resolvedUrl })
      return this.executeSocketIO(resolved)
    }

    logger.info('[WebSocketExecutionService] Connecting (websocket)', { requestId, url: resolved.resolvedUrl })
    return this.executeRawWebSocket(resolved)
  }

  /**
   * Resolve a request into the everything-resolved shape both the one-shot
   * `execute()` and the streaming `connectStreaming()` need: the env-resolved
   * URL (with secrets hydrated), the resolved headers, the message + event, and
   * the wire protocol. Throws when the request isn't registered (no resolved URL).
   */
  private async resolveExecution(requestId: string, timeout: number): Promise<ResolvedExecution> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      throw new Error('No resolved URL found for this request. Make sure the request is registered.')
    }
    let resolvedUrl = urlResult.resolvedUrl

    const requestContext = contextService.getRequestContext(requestId)

    // Resolve any SecretValues reachable from this request's KeyValue groups AND
    // from the active env-folder variable chain BEFORE the synchronous
    // header-resolution below.
    const envSecrets = contextService.collectEnvironmentSecrets(requestId)
    const secrets = [...collectRequestSecrets(requestContext?.keyValueGroups), ...envSecrets]
    if (secrets.length > 0) {
      await secretHydrationService.hydrate(requestId, secrets)
      if (envSecrets.length > 0) {
        contextService.refreshEnvironmentContext(requestId)
        resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? resolvedUrl
      }
    }

    // Build headers from context (skip disabled ones)
    const headers: Record<string, string> = {}
    const headersGroup = requestContext?.keyValueGroups.get('headers')
    if (headersGroup) {
      for (const h of headersGroup) {
        if (h.enabled === false) continue
        if (h.key) {
          // Type-aware: see `HTTPExecutionService`.
          headers[h.key] = contextService.resolveKeyValueForRequest(h, requestId)
        }
      }
    }

    // Get message and event from fullData. The renderer historically mirrors
    // the payload onto `fullData.body.content`, so fall back to that.
    const bodyContent = (requestContext?.fullData?.body as { content?: unknown } | undefined)?.content
    const message =
      requestContext?.fullData?.message ?? (typeof bodyContent === 'string' ? bodyContent : undefined) ?? '{}'
    const resolvedMessage = contextService.resolveValue(message, requestId)
    const event = requestContext?.fullData?.event
    // The transport lives on `fullData.protocol`; the renderer historically
    // mirrors it onto `fullData.method`, so accept either.
    const protocol = requestContext?.fullData?.protocol ?? requestContext?.fullData?.method

    return { requestId, timeout, startTime, startedAt, resolvedUrl, headers, resolvedMessage, event, protocol }
  }

  /**
   * Open a long-lived Socket.IO connection for the scenario engine and stream
   * its lifecycle through callbacks: `onConnect` once the socket opens,
   * `onMessage(event, payload)` for every server-pushed event (payload already
   * parsed from the wire), and `onClose(error?)` once it ends. Registers the
   * connection in the active map (so `send` / `disconnect` / the UI badge beam
   * all work) and returns a handle to drive + close it.
   *
   * Returns synchronously; the underlying resolution + connection happen async,
   * so `send` before `onConnect` is a no-op (returns false). `close()` is
   * idempotent.
   */
  connectStreaming(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    // A mutable holder (not a bare `let`): the caller's `close()` flips it from a
    // closure defined after the async body, so TS/eslint can't prove the read
    // below is always-false the way it would for a captured primitive.
    const ctl = { closedByCaller: false, connected: false, startTime: 0, startedAt: '', url: '' }
    const frames: WebSocketMessage[] = []
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      // Persist the streamed session to history (received frames included) so a
      // scenario socketioConnect node's preview can read it, mirroring http.
      if (ctl.startTime > 0) {
        this.persistHistory(requestId, {
          requestId,
          success: ctl.connected && error === undefined,
          connected: ctl.connected,
          messages: frames,
          ...(error !== undefined ? { error } : {}),
          requestUrl: ctl.url,
          timings: { startedAt: ctl.startedAt, durationMs: Date.now() - ctl.startTime }
        })
      }
      input.onClose(error)
    }

    void (async () => {
      let resolved: ResolvedExecution
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_WS_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (ctl.closedByCaller) { fireClose(); return }
      ctl.startTime = resolved.startTime
      ctl.startedAt = resolved.startedAt
      ctl.url = resolved.resolvedUrl

      let socket: Socket
      try {
        socket = io(resolved.resolvedUrl, {
          extraHeaders: Object.keys(resolved.headers).length > 0 ? resolved.headers : undefined,
          forceNew: true,
          reconnection: false,
          timeout: resolved.timeout
        })
      } catch (err) {
        fireClose((err as Error).message || 'Connection failed')
        return
      }

      const connection: ActiveConnection = { requestId, kind: 'socketio', socket, startTime: resolved.startTime, messages: [] }
      this.activeConnections.set(requestId, connection)
      this.broadcastProgress(requestId, 'started')

      socket.on('connect', () => {
        ctl.connected = true
        logger.info('[WebSocketExecutionService] Connected (socket.io, streaming)', { requestId })
        input.onConnect()
      })

      socket.onAny((eventName: string, ...args: unknown[]) => {
        const raw = args.length <= 1 ? args[0] : args
        const msg: WebSocketMessage = {
          direction: 'received',
          data: stringifyPayload(raw),
          event: eventName,
          timestamp: new Date().toISOString()
        }
        connection.messages.push(msg)
        frames.push(msg)
        this.broadcastMessage(requestId, msg)
        input.onMessage(eventName, raw)
      })

      socket.on('disconnect', () => {
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, 'completed')
        fireClose()
      })

      socket.on('connect_error', (err: Error) => {
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, 'error')
        fireClose(err.message || 'Connection error')
      })
    })()

    return {
      send: (channel, payload) => this.send(requestId, payload, channel),
      close: () => { ctl.closedByCaller = true; this.disconnect(requestId) },
      isOpen: () => this.isActive(requestId)
    }
  }

  /**
   * Raw-WebSocket counterpart of {@link connectStreaming} for the scenario
   * engine: opens a long-lived `ws` connection and streams its lifecycle through
   * the same callbacks. A raw WS has no events, so `onMessage` always gets
   * `undefined` as the event name. `send(_channel, payload)` does a plain
   * `ws.send(payload)` (the channel is ignored). Persists the session to history
   * on close, like the socket.io path.
   */
  connectStreamingRaw(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, connected: false, startTime: 0, startedAt: '', url: '' }
    const frames: WebSocketMessage[] = []
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      if (ctl.startTime > 0) {
        this.persistHistory(requestId, {
          requestId,
          success: ctl.connected && error === undefined,
          connected: ctl.connected,
          messages: frames,
          ...(error !== undefined ? { error } : {}),
          requestUrl: ctl.url,
          timings: { startedAt: ctl.startedAt, durationMs: Date.now() - ctl.startTime }
        })
      }
      input.onClose(error)
    }

    void (async () => {
      let resolved: ResolvedExecution
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_WS_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (ctl.closedByCaller) { fireClose(); return }
      ctl.startTime = resolved.startTime
      ctl.startedAt = resolved.startedAt
      ctl.url = resolved.resolvedUrl

      let ws: WebSocket
      try {
        ws = new WebSocket(resolved.resolvedUrl, { headers: resolved.headers })
      } catch (err) {
        fireClose((err as Error).message || 'Connection failed')
        return
      }

      const connection: ActiveConnection = { requestId, kind: 'websocket', ws, startTime: resolved.startTime, messages: [] }
      this.activeConnections.set(requestId, connection)
      this.broadcastProgress(requestId, 'started')

      ws.on('open', () => {
        ctl.connected = true
        logger.info('[WebSocketExecutionService] Connected (raw ws, streaming)', { requestId })
        input.onConnect()
      })
      ws.on('message', (data: WebSocket.Data) => {
        const str = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : JSON.stringify(data)
        const msg: WebSocketMessage = { direction: 'received', data: str, timestamp: new Date().toISOString() }
        connection.messages.push(msg)
        frames.push(msg)
        this.broadcastMessage(requestId, msg)
        let parsed: unknown
        try { parsed = JSON.parse(str) } catch { parsed = str }
        input.onMessage(undefined, parsed)
      })
      ws.on('close', () => {
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, 'completed')
        fireClose()
      })
      ws.on('error', (err: Error) => {
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, 'error')
        fireClose(err.message || 'Connection error')
      })
    })()

    return {
      send: (_channel, payload) => this.send(requestId, payload),
      close: () => { ctl.closedByCaller = true; this.disconnect(requestId) },
      isOpen: () => this.isActive(requestId)
    }
  }

  /** Raw WebSocket one-shot: connect, send, collect frames until close/timeout. */
  private executeRawWebSocket(resolved: ResolvedExecution): Promise<WebSocketExecutionResult> {
    const { requestId, timeout, startTime, startedAt, resolvedUrl, headers, resolvedMessage, event } = resolved

    return new Promise((resolve) => {
      const messages: WebSocketMessage[] = []
      let connected = false

      try {
        const ws = new WebSocket(resolvedUrl, { headers })

        const connection: ActiveConnection = { requestId, kind: 'websocket', ws, startTime, messages }
        this.activeConnections.set(requestId, connection)

        const timeoutId = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          }
        }, timeout)

        ws.on('open', () => {
          connected = true
          logger.info('[WebSocketExecutionService] Connected', { requestId })

          const msgToSend = event ? JSON.stringify({ event, data: resolvedMessage }) : resolvedMessage
          ws.send(msgToSend)
          const sent: WebSocketMessage = {
            direction: 'sent',
            data: resolvedMessage,
            event,
            timestamp: new Date().toISOString()
          }
          messages.push(sent)
          this.broadcastMessage(requestId, sent)
        })

        ws.on('message', (data: WebSocket.Data) => {
          const msgStr =
            typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : JSON.stringify(data)
          const msg: WebSocketMessage = {
            direction: 'received',
            data: msgStr,
            timestamp: new Date().toISOString()
          }
          messages.push(msg)
          this.broadcastMessage(requestId, msg)
        })

        ws.on('close', () => {
          clearTimeout(timeoutId)
          const durationMs = Date.now() - startTime
          this.activeConnections.delete(requestId)
          this.broadcastProgress(requestId, 'completed')

          resolve({
            requestId,
            success: connected,
            connected,
            messages,
            requestUrl: resolvedUrl,
            timings: { startedAt, durationMs }
          })
        })

        ws.on('error', (err: Error) => {
          clearTimeout(timeoutId)
          const durationMs = Date.now() - startTime
          this.activeConnections.delete(requestId)
          this.broadcastProgress(requestId, 'error')

          resolve({
            requestId,
            success: false,
            connected,
            messages,
            error: err.message,
            requestUrl: resolvedUrl,
            timings: { startedAt, durationMs }
          })
        })
      } catch (err) {
        const durationMs = Date.now() - startTime
        const error = err as Error
        this.broadcastProgress(requestId, 'error')

        resolve({
          requestId,
          success: false,
          connected: false,
          messages: [],
          error: error.message || 'Connection failed',
          requestUrl: resolvedUrl,
          timings: { startedAt, durationMs }
        })
      }
    })
  }

  /**
   * Socket.IO: connect and stay connected — streaming every server-pushed event
   * to the renderer — until the caller disconnects (no idle timeout; `timeout`
   * only bounds the initial connection attempt). Emitting is a separate `send()`
   * (the UI's Send button), so connecting alone is a pure listener. The
   * connection URL may carry a namespace path (e.g. `http://host:3001/chat`);
   * auth and query options arrive as headers for now.
   */
  private executeSocketIO(resolved: ResolvedExecution): Promise<WebSocketExecutionResult> {
    const { requestId, timeout, startTime, startedAt, resolvedUrl, headers } = resolved

    return new Promise((resolve) => {
      const messages: WebSocketMessage[] = []
      let connected = false
      let settled = false

      let socket: Socket
      try {
        socket = io(resolvedUrl, {
          // Default transports (polling → upgrade to websocket). Forcing
          // websocket-only breaks the engine.io handshake in the Electron main
          // process ("socket hang up") where a global WebSocket shadows `ws`.
          extraHeaders: Object.keys(headers).length > 0 ? headers : undefined,
          forceNew: true,
          reconnection: false,
          timeout
        })
      } catch (err) {
        const durationMs = Date.now() - startTime
        this.broadcastProgress(requestId, 'error')
        resolve({
          requestId,
          success: false,
          connected: false,
          messages: [],
          error: (err as Error).message || 'Connection failed',
          requestUrl: resolvedUrl,
          timings: { startedAt, durationMs }
        })
        return
      }

      const connection: ActiveConnection = { requestId, kind: 'socketio', socket, startTime, messages }
      this.activeConnections.set(requestId, connection)

      const finish = (success: boolean, error?: string): void => {
        if (settled) return
        settled = true
        try {
          socket.close()
        } catch {
          // already closed
        }
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, error ? 'error' : 'completed')
        const result: WebSocketExecutionResult = {
          requestId,
          success,
          connected,
          messages,
          ...(error ? { error } : {}),
          requestUrl: resolvedUrl,
          timings: { startedAt, durationMs: Date.now() - startTime }
        }
        // Persist the session (incl. received frames) to history so the response
        // panel + a scenario socketioConnect node's preview can read it later.
        this.persistHistory(requestId, result)
        resolve(result)
      }

      // No idle timeout: the connection stays open (listening) until the user
      // disconnects or the server drops it. `timeout` only bounds the initial
      // connection attempt (passed to `io(...)` above).

      const recordReceived = (eventName: string | undefined, value: unknown): void => {
        const msg: WebSocketMessage = {
          direction: 'received',
          data: stringifyPayload(value),
          event: eventName,
          timestamp: new Date().toISOString()
        }
        messages.push(msg)
        this.broadcastMessage(requestId, msg)
      }

      socket.on('connect', () => {
        connected = true
        logger.info('[WebSocketExecutionService] Connected (socket.io)', { requestId })
        // Connect only listens. Emitting is an explicit `send()` (the UI's
        // separate Send button), so a pure listener records no outgoing frame.
      })

      // Capture every server-pushed event (reserved events excluded by onAny).
      socket.onAny((eventName: string, ...args: unknown[]) => {
        recordReceived(eventName, args.length <= 1 ? args[0] : args)
      })

      // A disconnect (server-initiated or via `disconnect(requestId)`) resolves
      // the run early instead of waiting out the timeout.
      socket.on('disconnect', () => { finish(connected); })

      socket.on('connect_error', (err: Error) => {
        finish(false, err.message || 'Connection error')
      })
    })
  }

  /**
   * Disconnect an active connection
   */
  disconnect(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return false
    logger.info('[WebSocketExecutionService] Disconnecting', { requestId })
    if (connection.kind === 'websocket') {
      connection.ws?.close()
    } else {
      connection.socket?.close()
    }
    return true
  }

  /**
   * Send a message on an active connection
   */
  send(requestId: string, message: string, event?: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return false

    if (connection.kind === 'websocket') {
      if (connection.ws?.readyState !== WebSocket.OPEN) return false
      const msgToSend = event ? JSON.stringify({ event, data: message }) : message
      connection.ws.send(msgToSend)
    } else {
      if (!connection.socket?.connected) return false
      const channel = event && event.length > 0 ? event : 'message'
      const payload = parsePayload(message)
      // Emit with an acknowledgement: a server that replies via the ack callback
      // surfaces as a received `<event> (ack)` frame; a server that re-emits an
      // event is captured by the connection's `onAny` listener.
      connection.socket
        .timeout(DEFAULT_WS_TIMEOUT_MS)
        .emit(channel, payload, (err: Error | null, ...ackArgs: unknown[]) => {
          if (err || ackArgs.length === 0) return
          const ackMsg: WebSocketMessage = {
            direction: 'received',
            data: stringifyPayload(ackArgs.length === 1 ? ackArgs[0] : ackArgs),
            event: `${channel} (ack)`,
            timestamp: new Date().toISOString()
          }
          connection.messages.push(ackMsg)
          this.broadcastMessage(requestId, ackMsg)
        })
    }

    const msg: WebSocketMessage = {
      direction: 'sent',
      data: message,
      event,
      timestamp: new Date().toISOString()
    }
    connection.messages.push(msg)
    this.broadcastMessage(requestId, msg)
    return true
  }

  /**
   * Check if a connection is currently active
   */
  isActive(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return false
    if (connection.kind === 'websocket') {
      return connection.ws?.readyState === WebSocket.OPEN
    }
    return connection.socket?.connected === true
  }

  /**
   * Snapshot the message buffer for an active connection. Returns a
   * copy starting at `afterIndex` (default 0). Used by the MCP
   * `read_stream` tool to pull subsequent frames without blocking the
   * MCP channel for the full session lifetime.
   *
   * Returns `{ frames, total }`; `frames` is the slice from
   * `afterIndex` onwards, `total` is the buffer's current length so a
   * caller can detect cursor overshoot (e.g. after a buffer rebuild on
   * reconnect). Returns `null` when the connection is no longer
   * tracked at all (closed + dropped from the active map).
   */
  getMessages(requestId: string, afterIndex = 0): { frames: WebSocketMessage[]; total: number } | null {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return null
    const total = connection.messages.length
    const start = Math.max(0, Math.min(afterIndex, total))
    return { frames: connection.messages.slice(start), total }
  }

  /**
   * Broadcast progress to renderer
   */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('websocket:connection-progress', { requestId, status })
    }
  }

  /**
   * Broadcast message to renderer
   */
  private broadcastMessage(requestId: string, message: WebSocketMessage): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('websocket:message', { requestId, message })
    }
  }

  /**
   * Persist a finished session to the response history (fire-and-forget) so the
   * response panel + a scenario `socketioConnect` node's preview can read the
   * received frames later — the WebSocket analogue of an HTTP response history
   * entry. Failures are swallowed: history is best-effort, never blocks a run.
   */
  private persistHistory(requestId: string, result: WebSocketExecutionResult): void {
    void responseHistoryService.storeExecutionResult(requestId, 'websocket', result).catch(() => {
      // best-effort; a history write must never surface as a connection error
    })
  }
}

/** Singleton instance */
export const websocketExecutionService = new WebSocketExecutionService()

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
import { Server as SocketIOServer, type Socket as ServerSocket } from 'socket.io'
import { createServer, type Server as HttpServer } from 'node:http'
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

/** Active connection info — holds a raw WS, a Socket.IO client, or (when restorm
 * acts as the server) one hosted ROUTE: a socket.io namespace on a shared
 * per-port server (see {@link PortServer}). */
interface ActiveConnection {
  requestId: string
  kind: 'websocket' | 'socketio' | 'socketio-server'
  ws?: WebSocket
  socket?: Socket
  /** Port this server route listens on (server mode). */
  port?: number
  /** Socket.IO namespace this route hosts (server mode), e.g. `/` or `/chat`. */
  namespace?: string
  /** Tear down + resolve this server route's run (server mode). Idempotent. */
  serverSettle?: (success: boolean, error?: string) => void
  startTime: number
  messages: WebSocketMessage[]
}

/** A single socket.io server bound to ONE port, shared by every server route
 * (namespace) listening on that port. restorm hosts at most one OS socket per
 * port: many routes (e.g. `/` and `/chat`, or — for HTTP later — GET and POST)
 * coexist as distinct namespaces; only two routes with the SAME namespace on
 * the same port collide (the second fails to start). */
interface PortServer {
  httpServer: HttpServer
  ioServer: SocketIOServer
  /** Namespaces currently hosted on this port (the live routes). */
  routes: Set<string>
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
  /** When true, restorm HOSTS a socket.io server (localhost:port[/namespace])
   * instead of connecting as a client. */
  server: boolean
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
  /** One hosted socket.io server per port (server mode), shared across routes. */
  private portServers = new Map<number, PortServer>()
  /** In-flight port-server creations, so concurrent route starts on the same
   * port share ONE bind attempt instead of racing into EADDRINUSE. */
  private pendingPortServers = new Map<number, Promise<PortServer>>()

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

    if (resolved.server) {
      logger.info('[WebSocketExecutionService] Listening (socket.io server)', { requestId, url: resolved.resolvedUrl })
      return this.listenSocketIOServer(resolved)
    }

    if (resolved.protocol === 'socketio') {
      logger.info('[WebSocketExecutionService] Connecting (socket.io)', { requestId, url: resolved.resolvedUrl })
      return this.executeSocketIO(resolved)
    }

    logger.info('[WebSocketExecutionService] Connecting (websocket)', { requestId, url: resolved.resolvedUrl })
    return this.executeRawWebSocket(resolved)
  }

  /**
   * SERVER MODE: host a socket.io server on `localhost:<port><namespace>` and
   * stay listening until `disconnect`. Every event a connected client emits is
   * ACK'd on reception (so a client `emit(ev, data, cb)` resolves) and recorded
   * as a received frame; `send()` emits the configured payload to all connected
   * clients. Mirrors `executeSocketIO` (same active-connection registry,
   * broadcasts and history), but restorm is the server, not the client.
   */
  private listenSocketIOServer(resolved: ResolvedExecution): Promise<WebSocketExecutionResult> {
    const { requestId, startTime, startedAt, resolvedUrl } = resolved
    const { port, namespace } = this.parseServerAddress(resolvedUrl)

    return new Promise((resolve) => {
      const messages: WebSocketMessage[] = []
      let listening = false
      let settled = false

      // Tear down THIS route + resolve the run. The shared port server stays up
      // if other routes still listen on it (closed only when the last leaves).
      const finish = (success: boolean, error?: string): void => {
        if (settled) return
        settled = true
        this.releaseServerRoute(requestId)
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, error ? 'error' : 'completed')
        const result: WebSocketExecutionResult = {
          requestId,
          success,
          connected: listening,
          messages,
          ...(error ? { error } : {}),
          requestUrl: resolved.resolvedUrl,
          timings: { startedAt, durationMs: Date.now() - startTime }
        }
        this.persistHistory(requestId, result)
        resolve(result)
      }

      void (async () => {
        let portServer: PortServer
        try {
          portServer = await this.acquirePortServer(port)
        } catch (err) {
          finish(false, (err as Error).message || `Failed to listen on port ${port}`)
          return
        }
        // Route collision: the same namespace is already hosted on this port.
        if (portServer.routes.has(namespace)) {
          finish(false, this.routeBusyMessage(port, namespace))
          return
        }
        portServer.routes.add(namespace)
        listening = true
        this.registerServerNamespace(portServer.ioServer, namespace, requestId, messages)
        const connection: ActiveConnection = { requestId, kind: 'socketio-server', port, namespace, startTime, messages, serverSettle: finish }
        this.activeConnections.set(requestId, connection)
        logger.info('[WebSocketExecutionService] Socket.IO server route listening', { requestId, port, namespace })
        // No idle timeout: stay listening until disconnect() (the Stop button).
      })()
    })
  }

  /** Get-or-create the single socket.io server bound to `port`. Resolves once it
   * is listening; rejects if the OS port can't be bound (EADDRINUSE etc.). */
  private acquirePortServer(port: number): Promise<PortServer> {
    const existing = this.portServers.get(port)
    if (existing) return Promise.resolve(existing)
    // Coalesce concurrent first-time acquires so they share ONE bind attempt
    // (otherwise two routes starting at once each try to listen → EADDRINUSE).
    const inFlight = this.pendingPortServers.get(port)
    if (inFlight) return inFlight
    const promise = new Promise<PortServer>((resolve, reject) => {
      const httpServer = createServer()
      const ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } })
      const onError = (err: Error): void => { reject(err) }
      httpServer.once('error', onError)
      httpServer.listen(port, '127.0.0.1', () => {
        httpServer.removeListener('error', onError)
        const server: PortServer = { httpServer, ioServer, routes: new Set() }
        this.portServers.set(port, server)
        logger.info('[WebSocketExecutionService] Port server listening', { port })
        resolve(server)
      })
    })
    this.pendingPortServers.set(port, promise)
    void promise.catch(() => undefined).finally(() => { this.pendingPortServers.delete(port) })
    return promise
  }

  /** Attach the per-connection handlers to a namespace: record + broadcast every
   * received frame, ACK each event on reception, and forward to `onMessage`
   * (the scenario-engine streaming callback) when provided. */
  private registerServerNamespace(
    ioServer: SocketIOServer,
    namespace: string,
    requestId: string,
    frames: WebSocketMessage[],
    onMessage?: (event: string | undefined, payload: unknown) => void
  ): void {
    ioServer.of(namespace).on('connection', (socket: ServerSocket) => {
      const connected: WebSocketMessage = {
        direction: 'received', data: `client ${socket.id} connected`, event: 'connection', timestamp: new Date().toISOString()
      }
      frames.push(connected)
      this.broadcastMessage(requestId, connected)

      // ACK every received event on reception (so a client emit-with-ack
      // resolves) + record it as a received frame.
      socket.onAny((eventName: string, ...args: unknown[]) => {
        const last = args[args.length - 1]
        const hasAck = typeof last === 'function'
        const payloadArgs = hasAck ? args.slice(0, -1) : args
        const raw = payloadArgs.length <= 1 ? payloadArgs[0] : payloadArgs
        const msg: WebSocketMessage = {
          direction: 'received', data: stringifyPayload(raw), event: eventName, timestamp: new Date().toISOString()
        }
        frames.push(msg)
        this.broadcastMessage(requestId, msg)
        if (hasAck) (last as (ack: unknown) => void)({ ack: true, event: eventName })
        onMessage?.(eventName, raw)
      })

      socket.on('disconnect', () => {
        const left: WebSocketMessage = {
          direction: 'received', data: `client ${socket.id} disconnected`, event: 'disconnect', timestamp: new Date().toISOString()
        }
        frames.push(left)
        this.broadcastMessage(requestId, left)
      })
    })
  }

  /** Stop hosting one server route: drop its namespace handlers + kick its
   * clients, and — when it was the LAST route on the port — close the shared
   * port server. Safe to call for a non-server / unknown request. */
  private releaseServerRoute(requestId: string): void {
    const conn = this.activeConnections.get(requestId)
    if (conn?.kind !== 'socketio-server' || conn.port === undefined || conn.namespace === undefined) return
    const portServer = this.portServers.get(conn.port)
    if (!portServer) return
    try {
      const nsp = portServer.ioServer.of(conn.namespace)
      nsp.removeAllListeners('connection')
      nsp.disconnectSockets(true)
    } catch { /* namespace already torn down */ }
    portServer.routes.delete(conn.namespace)
    this.closePortServerIfIdle(conn.port)
  }

  /** Close + drop the port server only when no route holds it any more — the
   * last route leaving releases the OS socket. No-op while routes remain. */
  private closePortServerIfIdle(port: number): void {
    const portServer = this.portServers.get(port)
    if (!portServer || portServer.routes.size > 0) return
    try { portServer.httpServer.closeAllConnections() } catch { /* already closed */ }
    try { void portServer.ioServer.close() } catch { /* already closed */ }
    this.portServers.delete(port)
    logger.info('[WebSocketExecutionService] Port server closed (no routes left)', { port })
  }

  /** Human message for a route-collision (same namespace already on the port). */
  private routeBusyMessage(port: number, namespace: string): string {
    return namespace === '/'
      ? `A Socket.IO server is already listening on port ${port}`
      : `A Socket.IO server is already listening on ${namespace} (port ${port})`
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
    const server = requestContext?.fullData?.server === true

    return { requestId, timeout, startTime, startedAt, resolvedUrl, headers, resolvedMessage, event, protocol, server }
  }

  /** Parse `localhost:<port>[/<namespace>]` into a port + socket.io namespace.
   * Host is ignored (server always binds localhost); a missing port falls back
   * to the default Socket.IO port. */
  private parseServerAddress(resolvedUrl: string): { port: number; namespace: string } {
    const stripped = resolvedUrl.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const hostPort = slash >= 0 ? stripped.slice(0, slash) : stripped
    const namespace = slash >= 0 ? stripped.slice(slash) : '/'
    const portStr = hostPort.split(':')[1] ?? ''
    const port = Number.parseInt(portStr, 10)
    return { port: Number.isFinite(port) && port > 0 ? port : 3001, namespace: namespace || '/' }
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

  /**
   * SERVER-MODE counterpart of {@link connectStreaming} for the scenario engine:
   * HOST a socket.io server on `localhost:<port>[/namespace]` and stream its
   * lifecycle through the same callbacks. `onConnect` fires once the server is
   * listening; `onMessage(event, payload)` fires for every event a connected
   * client emits (already ACK'd on reception); `onClose()` fires once the server
   * is stopped. `send(channel, payload)` broadcasts to all connected clients.
   * Registers the connection so the scenario send/close bridge + the UI beam
   * work, exactly like the client path — restorm is just the server here.
   */
  connectStreamingServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, listening: false, startTime: 0, startedAt: '', url: '' }
    // Read through a function so flow analysis doesn't narrow it to `false` after
    // the first guard — `close()` (a closure defined below, called async) flips
    // it between the awaits, which TS can't see.
    const stopped = (): boolean => ctl.closedByCaller
    const messages: WebSocketMessage[] = []
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      // Tear down this route (closes the shared port server if it was the last).
      this.releaseServerRoute(requestId)
      this.activeConnections.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      if (ctl.startTime > 0) {
        this.persistHistory(requestId, {
          requestId,
          success: ctl.listening && error === undefined,
          connected: ctl.listening,
          messages,
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
      if (stopped()) { fireClose(); return }
      ctl.startTime = resolved.startTime
      ctl.startedAt = resolved.startedAt
      ctl.url = resolved.resolvedUrl

      const { port, namespace } = this.parseServerAddress(resolved.resolvedUrl)
      let portServer: PortServer
      try {
        portServer = await this.acquirePortServer(port)
      } catch (err) {
        fireClose((err as Error).message || `Failed to listen on port ${port}`)
        return
      }
      // The caller may have hit Stop while we were binding — the connection
      // wasn't tracked yet, so its close()/disconnect() no-op'd. Bail before
      // registering the route, and release the just-acquired port server if no
      // other route holds it (else it would listen forever, leaked).
      if (stopped()) {
        this.closePortServerIfIdle(port)
        fireClose()
        return
      }
      if (portServer.routes.has(namespace)) {
        fireClose(this.routeBusyMessage(port, namespace))
        return
      }
      portServer.routes.add(namespace)
      ctl.listening = true
      this.registerServerNamespace(portServer.ioServer, namespace, requestId, messages, input.onMessage)
      const connection: ActiveConnection = { requestId, kind: 'socketio-server', port, namespace, startTime: resolved.startTime, messages, serverSettle: (_ok, error) => { fireClose(error) } }
      this.activeConnections.set(requestId, connection)
      this.broadcastProgress(requestId, 'started')
      logger.info('[WebSocketExecutionService] Socket.IO server route listening (streaming)', { requestId, port, namespace })
      input.onConnect()
    })()

    return {
      send: (channel, payload) => this.send(requestId, payload, channel),
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
    } else if (connection.kind === 'socketio-server') {
      // Stop listening on this route. `serverSettle` runs releaseServerRoute()
      // (drops the namespace + closes the shared port server when it was the
      // last route), resolves the run, broadcasts 'completed' and drops the
      // connection from the active map.
      connection.serverSettle?.(true)
    } else {
      connection.socket?.close()
    }
    return true
  }

  /**
   * Tear down EVERY active connection + hosted server route. Called when the
   * open project closes (file close) or the app quits, so no client socket and
   * — crucially — no hosted Socket.IO server outlives the project that started
   * it (a leaked server would keep its port bound with no UI to stop it).
   */
  closeAll(): void {
    const count = this.activeConnections.size + this.portServers.size
    // Disconnect each tracked connection (a server route's disconnect closes
    // its shared port server once it was the last route). Snapshot the keys —
    // disconnect mutates the map.
    for (const requestId of [...this.activeConnections.keys()]) {
      try { this.disconnect(requestId) } catch { /* best-effort teardown */ }
    }
    // Defensive sweep: force-close any port server still bound (e.g. one whose
    // backing connection was already dropped from the active map).
    for (const port of [...this.portServers.keys()]) {
      const ps = this.portServers.get(port)
      if (!ps) continue
      ps.routes.clear()
      try { ps.httpServer.closeAllConnections() } catch { /* already closed */ }
      try { void ps.ioServer.close() } catch { /* already closed */ }
      this.portServers.delete(port)
    }
    if (count > 0) logger.info('[WebSocketExecutionService] Closed all connections + servers', { count })
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
    } else if (connection.kind === 'socketio-server') {
      // SERVER MODE: broadcast the GUI payload to every connected client on this
      // route's namespace. There's no ack to collect (clients receive a
      // broadcast, they don't reply), so this is purely outbound.
      if (connection.port === undefined) return false
      const portServer = this.portServers.get(connection.port)
      if (!portServer) return false
      const channel = event && event.length > 0 ? event : 'message'
      portServer.ioServer.of(connection.namespace ?? '/').emit(channel, parsePayload(message))
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
    if (connection.kind === 'socketio-server') {
      return connection.port !== undefined && this.portServers.has(connection.port)
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

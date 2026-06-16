/**
 * WebSocket Execution Service
 * Handles WebSocket and Socket.IO connections in the main process with
 * streaming support. The wire transport is chosen from the request's
 * `protocol` field: `websocket` uses the raw `ws` client, `socketio` uses
 * `socket.io-client`. Both share the same IPC surface, message model, and
 * active-connection registry.
 */

import WebSocket, { WebSocketServer } from 'ws'
import mqtt, { type MqttClient, type IClientOptions } from 'mqtt'
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
  kind: 'websocket' | 'socketio' | 'socketio-server' | 'websocket-server' | 'mqtt'
  ws?: WebSocket
  socket?: Socket
  /** MQTT client (kind 'mqtt'). */
  mqttClient?: MqttClient
  /** Default publish topic + QoS/retain for this MQTT request's Send button. */
  mqttTopic?: string
  mqttQos?: 0 | 1 | 2
  mqttRetain?: boolean
  /** Port this server route listens on (server mode). */
  port?: number
  /** The hosted route on that port (server mode): a Socket.IO namespace for a
   * `socketio-server`, or a URL path for a raw `websocket-server`. */
  namespace?: string
  /** Tear down + resolve this server route's run (server mode). Idempotent. */
  serverSettle?: (success: boolean, error?: string) => void
  startTime: number
  messages: WebSocketMessage[]
}

/** One hosted raw-WebSocket route: its connected client sockets + the handler
 * that wires a freshly-upgraded socket (record/broadcast/forward frames). */
interface WsRoute {
  sockets: Set<WebSocket>
  onConnection: (ws: WebSocket) => void
}

/** ONE shared http server bound to a port, that EVERY server-mode protocol
 * attaches to — so a Socket.IO server, a raw-WebSocket server (and, later, HTTP
 * / GraphQL / SOAP / OData) can coexist on the SAME port:
 * - Socket.IO attaches an `ioServer` (claims `/socket.io/` + its namespaces),
 * - raw WS attaches a `noServer` `wss` + an `upgrade` dispatcher routing by PATH.
 * restorm holds at most one OS socket per port. A route collides only with
 * another route of the SAME role on the SAME path/namespace + port. The port is
 * released when its LAST route (across all protocols) stops. */
interface PortHost {
  httpServer: HttpServer
  /** Lazily attached on the first Socket.IO route on this port. */
  ioServer?: SocketIOServer
  /** Lazily attached (noServer) on the first raw-WS route on this port. */
  wss?: WebSocketServer
  /** Live Socket.IO namespaces hosted here. */
  sioRoutes: Set<string>
  /** Live raw-WS routes (URL path → its sockets + connection handler). */
  wsRoutes: Map<string, WsRoute>
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
  /** MQTT-only resolved fields (protocol === 'mqtt'; `event` carries the topic). */
  mqtt?: {
    qos: 0 | 1 | 2
    retain: boolean
    clientId?: string
    username?: string
    password?: string
    keepalive?: number
    subscribe: boolean
    will?: { topic: string; payload: string; qos: 0 | 1 | 2; retain: boolean }
  }
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
  /** One shared http host per port (server mode) — every protocol's routes
   * attach here, so SIO + raw-WS (+ future HTTP) coexist on one port. */
  private portHosts = new Map<number, PortHost>()
  /** In-flight host creations, so concurrent route starts on the same port
   * share ONE bind attempt instead of racing into EADDRINUSE. */
  private pendingPortHosts = new Map<number, Promise<PortHost>>()

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
      if (resolved.protocol === 'socketio') {
        logger.info('[WebSocketExecutionService] Listening (socket.io server)', { requestId, url: resolved.resolvedUrl })
        return this.listenSocketIOServer(resolved)
      }
      logger.info('[WebSocketExecutionService] Listening (websocket server)', { requestId, url: resolved.resolvedUrl })
      return this.listenRawWebSocketServer(resolved)
    }

    if (resolved.protocol === 'mqtt') {
      logger.info('[WebSocketExecutionService] Connecting (mqtt)', { requestId, url: resolved.resolvedUrl })
      return this.executeMqtt(resolved)
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
        let host: PortHost
        try {
          host = await this.acquirePortHost(port)
        } catch (err) {
          finish(false, (err as Error).message || `Failed to listen on port ${port}`)
          return
        }
        // Route collision: the same namespace is already hosted on this port.
        if (host.sioRoutes.has(namespace)) {
          finish(false, this.routeBusyMessage('Socket.IO', port, namespace))
          return
        }
        host.sioRoutes.add(namespace)
        listening = true
        this.registerServerNamespace(this.ensureIoServer(host), namespace, requestId, messages)
        const connection: ActiveConnection = { requestId, kind: 'socketio-server', port, namespace, startTime, messages, serverSettle: finish }
        this.activeConnections.set(requestId, connection)
        logger.info('[WebSocketExecutionService] Socket.IO server route listening', { requestId, port, namespace })
        // No idle timeout: stay listening until disconnect() (the Stop button).
      })()
    })
  }

  /**
   * SERVER MODE (raw WebSocket): host a `ws://localhost:<port><path>` route and
   * stay listening until `disconnect`. Each frame a connected client sends is
   * recorded (no ACK — raw WS has none); `send()` broadcasts the configured
   * payload to every client on this route. Shares the port host with any other
   * protocol's routes, so a raw-WS server and a Socket.IO server coexist on one
   * port (routed by path vs `/socket.io/`).
   */
  private listenRawWebSocketServer(resolved: ResolvedExecution): Promise<WebSocketExecutionResult> {
    const { requestId, startTime, startedAt, resolvedUrl } = resolved
    const { port, namespace: path } = this.parseServerAddress(resolvedUrl)

    return new Promise((resolve) => {
      const messages: WebSocketMessage[] = []
      let listening = false
      let settled = false
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
        let host: PortHost
        try {
          host = await this.acquirePortHost(port)
        } catch (err) {
          finish(false, (err as Error).message || `Failed to listen on port ${port}`)
          return
        }
        if (host.wsRoutes.has(path)) {
          finish(false, this.routeBusyMessage('WebSocket', port, path))
          return
        }
        this.ensureWss(host)
        host.wsRoutes.set(path, this.makeWsRoute(requestId, messages))
        listening = true
        const connection: ActiveConnection = { requestId, kind: 'websocket-server', port, namespace: path, startTime, messages, serverSettle: finish }
        this.activeConnections.set(requestId, connection)
        logger.info('[WebSocketExecutionService] WebSocket server route listening', { requestId, port, path })
      })()
    })
  }

  /** Build a raw-WS route: each upgraded client socket is tracked, and its frames
   * are recorded + broadcast to the renderer + forwarded to `onMessage` (the
   * scenario-engine streaming callback) when provided. */
  private makeWsRoute(
    requestId: string,
    frames: WebSocketMessage[],
    onMessage?: (event: string | undefined, payload: unknown) => void
  ): WsRoute {
    const route: WsRoute = {
      sockets: new Set<WebSocket>(),
      onConnection: (ws: WebSocket): void => {
        route.sockets.add(ws)
        const connected: WebSocketMessage = { direction: 'received', data: 'client connected', event: 'connection', timestamp: new Date().toISOString() }
        frames.push(connected)
        this.broadcastMessage(requestId, connected)
        this.broadcastServerClients(requestId, route.sockets.size)
        ws.on('message', (data: WebSocket.Data) => {
          const str = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : JSON.stringify(data)
          const msg: WebSocketMessage = { direction: 'received', data: str, timestamp: new Date().toISOString() }
          frames.push(msg)
          this.broadcastMessage(requestId, msg)
          let parsed: unknown
          try { parsed = JSON.parse(str) } catch { parsed = str }
          onMessage?.(undefined, parsed)
        })
        ws.on('close', () => {
          route.sockets.delete(ws)
          const left: WebSocketMessage = { direction: 'received', data: 'client disconnected', event: 'disconnect', timestamp: new Date().toISOString() }
          frames.push(left)
          this.broadcastMessage(requestId, left)
          this.broadcastServerClients(requestId, route.sockets.size)
        })
        ws.on('error', (err: Error) => {
          logger.warn('[WebSocketExecutionService] server client socket error', { requestId, error: err.message })
          route.sockets.delete(ws)
          this.broadcastServerClients(requestId, route.sockets.size)
        })
      }
    }
    return route
  }

  /** Get-or-create the shared http host bound to `port` — no protocol attached
   * yet (SIO / raw-WS attach lazily). Resolves once listening; rejects if the OS
   * port can't be bound (EADDRINUSE etc.). Concurrent first-time acquires share
   * ONE bind attempt (else two routes starting at once race into EADDRINUSE). */
  private acquirePortHost(port: number): Promise<PortHost> {
    const existing = this.portHosts.get(port)
    if (existing) return Promise.resolve(existing)
    const inFlight = this.pendingPortHosts.get(port)
    if (inFlight) return inFlight
    const promise = new Promise<PortHost>((resolve, reject) => {
      const httpServer = createServer()
      const onError = (err: Error): void => { reject(err) }
      httpServer.once('error', onError)
      httpServer.listen(port, '127.0.0.1', () => {
        httpServer.removeListener('error', onError)
        // Permanent runtime handler: once the bind-error listener above is
        // removed, a later socket 'error' would otherwise be unhandled and throw
        // in the main process. Log + swallow instead.
        httpServer.on('error', (e: Error) => { logger.warn('[WebSocketExecutionService] port host runtime error', { port, error: e.message }) })
        const host: PortHost = { httpServer, sioRoutes: new Set(), wsRoutes: new Map() }
        this.portHosts.set(port, host)
        logger.info('[WebSocketExecutionService] Port host listening', { port })
        resolve(host)
      })
    })
    this.pendingPortHosts.set(port, promise)
    void promise.catch(() => undefined).finally(() => { this.pendingPortHosts.delete(port) })
    return promise
  }

  /** Attach a Socket.IO server to the host on first use (claims `/socket.io/`). */
  private ensureIoServer(host: PortHost): SocketIOServer {
    host.ioServer ??= new SocketIOServer(host.httpServer, { cors: { origin: '*' } })
    return host.ioServer
  }

  /** Attach a `noServer` raw-WS server + the path-routing `upgrade` dispatcher on
   * first use. Socket.IO (when present) owns `/socket.io/` upgrades; engine.io
   * leaves other paths alone, so this dispatcher claims them by path. An unknown
   * path with no socket.io to take it is rejected. */
  private ensureWss(host: PortHost): WebSocketServer {
    if (host.wss) return host.wss
    const wss = new WebSocketServer({ noServer: true })
    host.wss = wss
    host.httpServer.on('upgrade', (req, socket, head) => {
      const path = this.parsePathname(req.url ?? '/')
      const route = host.wsRoutes.get(path)
      if (route) {
        wss.handleUpgrade(req, socket, head, (ws) => { route.onConnection(ws) })
      } else if (!host.ioServer) {
        socket.destroy()
      }
      // else: leave it for socket.io (it owns `/socket.io/`).
    })
    return wss
  }

  /** Total live routes on a port across every protocol (drives port teardown). */
  private hostRouteCount(host: PortHost): number {
    return host.sioRoutes.size + host.wsRoutes.size
  }

  /** Extract just the pathname from a request URL (drop the query). */
  private parsePathname(url: string): string {
    const q = url.indexOf('?')
    const path = q >= 0 ? url.slice(0, q) : url
    return path.length > 0 ? path : '/'
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
    let clients = 0
    ioServer.of(namespace).on('connection', (socket: ServerSocket) => {
      clients += 1
      const connected: WebSocketMessage = {
        direction: 'received', data: `client ${socket.id} connected`, event: 'connection', timestamp: new Date().toISOString()
      }
      frames.push(connected)
      this.broadcastMessage(requestId, connected)
      this.broadcastServerClients(requestId, clients)

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
        clients = Math.max(0, clients - 1)
        const left: WebSocketMessage = {
          direction: 'received', data: `client ${socket.id} disconnected`, event: 'disconnect', timestamp: new Date().toISOString()
        }
        frames.push(left)
        this.broadcastMessage(requestId, left)
        this.broadcastServerClients(requestId, clients)
      })
    })
  }

  /** Stop hosting one server route: drop its namespace handlers + kick its
   * clients, and — when it was the LAST route on the port — close the shared
   * port server. Safe to call for a non-server / unknown request. */
  private releaseServerRoute(requestId: string): void {
    const conn = this.activeConnections.get(requestId)
    if (conn?.port === undefined || conn.namespace === undefined) return
    const host = this.portHosts.get(conn.port)
    if (!host) return
    if (conn.kind === 'socketio-server' && host.ioServer) {
      try {
        const nsp = host.ioServer.of(conn.namespace)
        nsp.removeAllListeners('connection')
        nsp.disconnectSockets(true)
      } catch { /* namespace already torn down */ }
      host.sioRoutes.delete(conn.namespace)
    } else if (conn.kind === 'websocket-server') {
      const route = host.wsRoutes.get(conn.namespace)
      if (route) {
        for (const ws of route.sockets) { try { ws.terminate() } catch { /* already gone */ } }
        route.sockets.clear()
      }
      host.wsRoutes.delete(conn.namespace)
    }
    this.closePortHostIfIdle(conn.port)
  }

  /** Close + drop the shared port host only when no route (ANY protocol) holds it
   * any more — the last route leaving releases the OS socket. No-op otherwise. */
  private closePortHostIfIdle(port: number): void {
    const host = this.portHosts.get(port)
    if (!host || this.hostRouteCount(host) > 0) return
    this.tearDownPortHost(host)
    this.portHosts.delete(port)
    logger.info('[WebSocketExecutionService] Port host closed (no routes left)', { port })
  }

  /** Close a host's OS socket + attached protocol servers. `ioServer.close()`
   * ALSO closes the underlying http server (socket.io owns it); for a host with
   * NO socket.io we must close the http server ourselves — a `noServer` `ws`
   * server does not own it, so `wss.close()` alone would leak the bound port. */
  private tearDownPortHost(host: PortHost): void {
    try { host.httpServer.closeAllConnections() } catch { /* already closed */ }
    try { host.wss?.close() } catch { /* already closed */ }
    if (host.ioServer) {
      try { void host.ioServer.close() } catch { /* already closed */ }
    } else {
      try { host.httpServer.close() } catch { /* already closed */ }
    }
  }

  /** Human message for a route-collision (same route already on the port). */
  private routeBusyMessage(label: string, port: number, route: string): string {
    return route === '/'
      ? `A ${label} server is already listening on port ${port}`
      : `A ${label} server is already listening on ${route} (port ${port})`
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

    // MQTT: resolve handlebars on the connection-shaping fields (topic lives on
    // `event`, already captured above) + normalise QoS to 0|1|2. Only built when
    // this is an MQTT request so the websocket/socketio paths stay untouched.
    let mqttConfig: ResolvedExecution['mqtt']
    if (protocol === 'mqtt') {
      const fd = requestContext?.fullData
      const resolveOpt = (v: string | undefined): string | undefined =>
        v !== undefined && v !== '' ? contextService.resolveValue(v, requestId) : undefined
      const normQos = (q: number | undefined): 0 | 1 | 2 => (q === 1 || q === 2 ? q : 0)
      const willTopic = resolveOpt(fd?.lwtTopic)
      mqttConfig = {
        qos: normQos(fd?.qos),
        retain: fd?.retain === true,
        ...(resolveOpt(fd?.clientId) !== undefined ? { clientId: resolveOpt(fd?.clientId) } : {}),
        ...(resolveOpt(fd?.username) !== undefined ? { username: resolveOpt(fd?.username) } : {}),
        ...(resolveOpt(fd?.password) !== undefined ? { password: resolveOpt(fd?.password) } : {}),
        ...(fd?.keepalive !== undefined ? { keepalive: fd.keepalive } : {}),
        // Subscribe to the request's topic on connect unless explicitly disabled.
        subscribe: fd?.mqttSubscribe !== false,
        ...(willTopic !== undefined ? {
          will: {
            topic: willTopic,
            payload: resolveOpt(fd?.lwtPayload) ?? '',
            qos: normQos(fd?.lwtQos),
            retain: fd?.lwtRetain === true
          }
        } : {})
      }
    }

    return { requestId, timeout, startTime, startedAt, resolvedUrl, headers, resolvedMessage, event, protocol, server, ...(mqttConfig ? { mqtt: mqttConfig } : {}) }
  }

  /** Parse `localhost:<port>[/<namespace>]` into a port + socket.io namespace.
   * Host is ignored (server always binds localhost); a missing port falls back
   * to the default Socket.IO port. */
  private parseServerAddress(resolvedUrl: string): { port: number; namespace: string } {
    const stripped = resolvedUrl.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const hostPort = slash >= 0 ? stripped.slice(0, slash) : stripped
    // Drop any `?query` so the registered route key matches what the http
    // `upgrade` dispatcher looks up via `parsePathname` (which strips it too) —
    // otherwise a `localhost:3002/chat?x=1` server never matches a `/chat` upgrade.
    const rawNamespace = slash >= 0 ? stripped.slice(slash) : '/'
    const namespace = this.parsePathname(rawNamespace)
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
   * MQTT counterpart of {@link connectStreamingRaw} for the scenario engine:
   * connect to the broker, SUBSCRIBE to the bound request's topic, and stream the
   * lifecycle through the callbacks — `onConnect` once subscribed, `onMessage`
   * for every received message (event always `undefined`, like raw WS), `onClose`
   * when the connection ends. `send(_, payload)` publishes to the connection's
   * topic. mqtt.js auto-reconnects with backoff (and re-subscribes); `timeout`
   * bounds only the INITIAL connect.
   */
  connectStreamingMqtt(input: {
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

      const cfg = resolved.mqtt ?? { qos: 0 as const, retain: false, subscribe: true }
      const topic = resolved.event && resolved.event.length > 0 ? resolved.event : undefined

      try {
        const opts: IClientOptions = {
          connectTimeout: resolved.timeout,
          reconnectPeriod: 1000,
          ...(cfg.clientId ? { clientId: cfg.clientId } : {}),
          ...(cfg.username ? { username: cfg.username } : {}),
          ...(cfg.password ? { password: cfg.password } : {}),
          ...(cfg.keepalive !== undefined ? { keepalive: cfg.keepalive } : {}),
          ...(cfg.will ? { will: { topic: cfg.will.topic, payload: Buffer.from(cfg.will.payload), qos: cfg.will.qos, retain: cfg.will.retain } } : {})
        }
        const client = mqtt.connect(resolved.resolvedUrl, opts)

        const connection: ActiveConnection = {
          requestId, kind: 'mqtt', mqttClient: client, startTime: resolved.startTime, messages: [],
          mqttQos: cfg.qos, mqttRetain: cfg.retain, ...(topic ? { mqttTopic: topic } : {})
        }
        this.activeConnections.set(requestId, connection)
        this.broadcastProgress(requestId, 'started')

        const connectTimer = setTimeout(() => {
          if (!ctl.connected) {
            this.activeConnections.delete(requestId)
            this.broadcastProgress(requestId, 'error')
            try { client.end(true) } catch { /* already ended */ }
            fireClose('Connection timed out')
          }
        }, resolved.timeout)

        client.on('connect', () => {
          ctl.connected = true
          clearTimeout(connectTimer)
          logger.info('[WebSocketExecutionService] Connected (mqtt, streaming)', { requestId })
          if (cfg.subscribe && topic) {
            client.subscribe(topic, { qos: cfg.qos }, (err) => {
              if (err) logger.warn('[WebSocketExecutionService] mqtt subscribe failed', { requestId, error: err.message })
            })
          }
          input.onConnect()
        })
        client.on('message', (t: string, payload: Buffer) => {
          const str = payload.toString('utf8')
          const msg: WebSocketMessage = { direction: 'received', data: str, event: t, timestamp: new Date().toISOString() }
          connection.messages.push(msg)
          frames.push(msg)
          this.broadcastMessage(requestId, msg)
          let parsed: unknown
          try { parsed = JSON.parse(str) } catch { parsed = str }
          input.onMessage(undefined, parsed)
        })
        client.on('error', (err: Error) => {
          // Pre-connect error (auth / unreachable) is terminal; post-connect
          // errors are transient (reconnect handles them).
          if (!ctl.connected) {
            clearTimeout(connectTimer)
            this.activeConnections.delete(requestId)
            this.broadcastProgress(requestId, 'error')
            fireClose(err.message)
          }
        })
        // 'end' (explicit disconnect / timeout / error) is the terminal signal;
        // 'close' is not (reconnect may follow).
        client.on('end', () => {
          this.activeConnections.delete(requestId)
          this.broadcastProgress(requestId, 'completed')
          fireClose()
        })
      } catch (err) {
        fireClose((err as Error).message || 'Connection failed')
      }
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
      let host: PortHost
      try {
        host = await this.acquirePortHost(port)
      } catch (err) {
        fireClose((err as Error).message || `Failed to listen on port ${port}`)
        return
      }
      // The caller may have hit Stop while we were binding — the connection
      // wasn't tracked yet, so its close()/disconnect() no-op'd. Bail before
      // registering the route, and release the just-acquired port host if no
      // other route holds it (else it would listen forever, leaked).
      if (stopped()) {
        this.closePortHostIfIdle(port)
        fireClose()
        return
      }
      if (host.sioRoutes.has(namespace)) {
        fireClose(this.routeBusyMessage('Socket.IO', port, namespace))
        return
      }
      host.sioRoutes.add(namespace)
      ctl.listening = true
      this.registerServerNamespace(this.ensureIoServer(host), namespace, requestId, messages, input.onMessage)
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

  /**
   * SERVER-MODE counterpart of {@link connectStreamingRaw} for the scenario
   * engine: HOST a raw-WebSocket route on `localhost:<port><path>` and stream its
   * lifecycle through the callbacks. `onConnect` fires once listening;
   * `onMessage(undefined, payload)` fires for each frame a client sends (raw WS
   * has no event name); `onClose()` once stopped. `send(_channel, payload)`
   * broadcasts to every client on the route. Shares the port host with any other
   * protocol's routes.
   */
  connectStreamingRawServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, listening: false, startTime: 0, startedAt: '', url: '' }
    const stopped = (): boolean => ctl.closedByCaller
    const messages: WebSocketMessage[] = []
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
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

      const { port, namespace: path } = this.parseServerAddress(resolved.resolvedUrl)
      let host: PortHost
      try {
        host = await this.acquirePortHost(port)
      } catch (err) {
        fireClose((err as Error).message || `Failed to listen on port ${port}`)
        return
      }
      if (stopped()) {
        this.closePortHostIfIdle(port)
        fireClose()
        return
      }
      if (host.wsRoutes.has(path)) {
        fireClose(this.routeBusyMessage('WebSocket', port, path))
        return
      }
      this.ensureWss(host)
      host.wsRoutes.set(path, this.makeWsRoute(requestId, messages, input.onMessage))
      ctl.listening = true
      const connection: ActiveConnection = { requestId, kind: 'websocket-server', port, namespace: path, startTime: resolved.startTime, messages, serverSettle: (_ok, error) => { fireClose(error) } }
      this.activeConnections.set(requestId, connection)
      this.broadcastProgress(requestId, 'started')
      logger.info('[WebSocketExecutionService] WebSocket server route listening (streaming)', { requestId, port, path })
      input.onConnect()
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
   * MQTT: connect to the broker, SUBSCRIBE to the request's topic (so received
   * messages stream to the renderer), and stay connected — mqtt.js auto-reconnects
   * with backoff and re-subscribes on reconnect — until the caller disconnects.
   * `timeout` bounds only the INITIAL connect; PUBLISH is a separate `send()` (the
   * UI's Send button). Auth failure / unreachable broker resolve the run with an
   * error. The whole session (sent publishes + received frames) persists to
   * history for the response panel + a scenario node's preview.
   */
  private executeMqtt(resolved: ResolvedExecution): Promise<WebSocketExecutionResult> {
    const { requestId, timeout, startTime, startedAt, resolvedUrl, event } = resolved
    const cfg = resolved.mqtt ?? { qos: 0 as const, retain: false, subscribe: true }
    const topic = event && event.length > 0 ? event : undefined

    return new Promise((resolve) => {
      const messages: WebSocketMessage[] = []
      let connected = false
      let settled = false

      const record = (data: string, evt: string | undefined): void => {
        const msg: WebSocketMessage = { direction: 'received', data, event: evt, timestamp: new Date().toISOString() }
        messages.push(msg)
        this.broadcastMessage(requestId, msg)
      }

      let client: MqttClient | undefined
      const finish = (success: boolean, error?: string): void => {
        if (settled) return
        settled = true
        try { client?.end(true) } catch { /* already ended */ }
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
        this.persistHistory(requestId, result)
        resolve(result)
      }

      try {
        const opts: IClientOptions = {
          connectTimeout: timeout,
          // Reconnect with backoff; mqtt.js re-subscribes on reconnect by default.
          reconnectPeriod: 1000,
          ...(cfg.clientId ? { clientId: cfg.clientId } : {}),
          ...(cfg.username ? { username: cfg.username } : {}),
          ...(cfg.password ? { password: cfg.password } : {}),
          ...(cfg.keepalive !== undefined ? { keepalive: cfg.keepalive } : {}),
          ...(cfg.will ? { will: { topic: cfg.will.topic, payload: Buffer.from(cfg.will.payload), qos: cfg.will.qos, retain: cfg.will.retain } } : {})
        }
        const c = mqtt.connect(resolvedUrl, opts)
        client = c

        const connection: ActiveConnection = {
          requestId, kind: 'mqtt', mqttClient: c, startTime, messages,
          mqttQos: cfg.qos, mqttRetain: cfg.retain, ...(topic ? { mqttTopic: topic } : {})
        }
        this.activeConnections.set(requestId, connection)

        // Bound the INITIAL connect: if the broker never accepts us within the
        // timeout (down / unreachable), fail rather than retry forever.
        const connectTimer = setTimeout(() => { if (!connected) finish(false, 'Connection timed out') }, timeout)

        c.on('connect', () => {
          connected = true
          clearTimeout(connectTimer)
          logger.info('[WebSocketExecutionService] Connected (mqtt)', { requestId })
          record(topic ? `connected; subscribing to ${topic}` : 'connected', 'connect')
          if (cfg.subscribe && topic) {
            c.subscribe(topic, { qos: cfg.qos }, (err, granted) => {
              if (err) { record(`subscribe error: ${err.message}`, 'error'); return }
              const grantedQos = granted?.map((g) => g.qos).join(',')
              record(`subscribed ${topic}${grantedQos !== undefined ? ` (qos ${grantedQos})` : ''}`, 'subscribe')
            })
          }
        })

        c.on('message', (t: string, payload: Buffer) => {
          record(payload.toString('utf8'), t)
        })

        c.on('reconnect', () => { record('reconnecting…', 'reconnect') })

        c.on('error', (err: Error) => {
          // Auth failure / protocol error: surface it. If it happened before we
          // ever connected, the run can't proceed — fail (which also ends the
          // client, stopping the retry loop).
          record(`error: ${err.message}`, 'error')
          if (!connected) { clearTimeout(connectTimer); finish(false, err.message) }
        })

        // 'close' fires on every dropped connection; with reconnect on it is NOT
        // terminal (a 'reconnect' → 'connect' follows), so we don't finish here.
        // 'end' fires only when the client is explicitly ended (disconnect / timeout
        // / error) — that is the terminal signal.
        c.on('end', () => { finish(connected) })
      } catch (err) {
        finish(false, (err as Error).message || 'Connection failed')
      }
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
    } else if (connection.kind === 'mqtt') {
      // force-end stops mqtt.js's auto-reconnect loop and fires 'end' → finish().
      connection.mqttClient?.end(true)
    } else if (connection.kind === 'socketio-server' || connection.kind === 'websocket-server') {
      // Stop listening on this route. `serverSettle` runs releaseServerRoute()
      // (drops the route + closes the shared port host when it was the last
      // route, any protocol), resolves the run, broadcasts 'completed' and drops
      // the connection from the active map.
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
    const count = this.activeConnections.size + this.portHosts.size
    // Disconnect each tracked connection (a server route's disconnect closes its
    // shared port host once it was the last route). Snapshot the keys —
    // disconnect mutates the map.
    for (const requestId of [...this.activeConnections.keys()]) {
      try { this.disconnect(requestId) } catch { /* best-effort teardown */ }
    }
    // Defensive sweep: force-close any port host still bound (e.g. one whose
    // backing connection was already dropped from the active map).
    for (const port of [...this.portHosts.keys()]) {
      const host = this.portHosts.get(port)
      if (!host) continue
      host.sioRoutes.clear()
      host.wsRoutes.clear()
      this.tearDownPortHost(host)
      this.portHosts.delete(port)
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
      const host = this.portHosts.get(connection.port)
      if (!host?.ioServer) return false
      const channel = event && event.length > 0 ? event : 'message'
      host.ioServer.of(connection.namespace ?? '/').emit(channel, parsePayload(message))
    } else if (connection.kind === 'websocket-server') {
      // SERVER MODE (raw WS): broadcast the GUI payload to every client on this
      // route's path. Raw frames, no event envelope, no ack.
      if (connection.port === undefined || connection.namespace === undefined) return false
      const route = this.portHosts.get(connection.port)?.wsRoutes.get(connection.namespace)
      if (!route) return false
      for (const ws of route.sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message)
      }
    } else if (connection.kind === 'mqtt') {
      // PUBLISH the GUI payload. `event` carries the publish topic (falls back to
      // the request's own topic); QoS + retain come from the request config.
      if (connection.mqttClient?.connected !== true) return false
      const topic = event && event.length > 0 ? event : connection.mqttTopic
      if (!topic) return false
      connection.mqttClient.publish(topic, message, { qos: connection.mqttQos ?? 0, retain: connection.mqttRetain ?? false })
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
    if (connection.kind === 'mqtt') {
      return connection.mqttClient?.connected === true
    }
    if (connection.kind === 'socketio-server') {
      return connection.port !== undefined && this.portHosts.has(connection.port)
    }
    if (connection.kind === 'websocket-server') {
      return connection.port !== undefined && connection.namespace !== undefined
        && this.portHosts.get(connection.port)?.wsRoutes.has(connection.namespace) === true
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
   * Broadcast a hosted server's live CONNECTED-CLIENT count to the renderer — the
   * request panel shows "N clients connected" while listening. Fired on every
   * client connect / disconnect for a server-mode route.
   */
  private broadcastServerClients(requestId: string, count: number): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('websocket:server-clients', { requestId, count })
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

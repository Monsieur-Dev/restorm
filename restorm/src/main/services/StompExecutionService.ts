/**
 * STOMP Execution Service
 *
 * A standalone service (does NOT call into `WebSocketExecutionService`) that
 * opens a raw `ws` connection — the same transport-layer pattern
 * `WebSocketExecutionService.connectStreamingRaw` uses — and layers the STOMP
 * 1.1/1.2 CONNECT/CONNECTED handshake, SUBSCRIBE/SEND/ACK/NACK/DISCONNECT
 * frame lifecycle, and heart-beat negotiation on top. Kept separate from the
 * WebSocket service so STOMP's connection lifecycle never couples to that
 * service's connection-tracking internals (its own `activeConnections`
 * registry, its own `disconnect`/`send`/`isActive`).
 */

import WebSocket from 'ws'
import { BrowserWindow } from 'electron'
import { logger, withFirewallBypassSync } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_WS_TIMEOUT_MS } from '../../shared/config/constants'
import { encodeStompFrame, parseStompFrames, type StompFrame } from './stomp/stompFrame'

/** STOMP request execution input */
export interface StompExecutionInput {
  requestId: string
  timeout?: number
}

/** One STOMP frame exchanged on the connection. */
export interface StompMessage {
  direction: 'sent' | 'received'
  command: string
  subscription?: string
  destination?: string
  headers: Record<string, string>
  body: string
  timestamp: string
}

/** STOMP execution result */
export interface StompExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  messages: StompMessage[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

interface StompSubscriptionConfig {
  id: string
  destination: string
  ackMode: 'auto' | 'client' | 'client-individual'
}

/** A live connection (one-shot `execute()` or the scenario engine's streaming
 * connect). Held so `send()` / `ack()` / `nack()` / `disconnect()` /
 * `isActive()` can reach it by requestId. */
interface ActiveStompConnection {
  requestId: string
  ws: WebSocket
  connected: boolean
  subscriptions: StompSubscriptionConfig[]
  /** Outgoing heart-beat timer, armed once CONNECTED negotiates one. */
  heartbeatTimer?: NodeJS.Timeout
  startTime: number
  messages: StompMessage[]
}

/** Resolved inputs shared by every connection path. */
interface ResolvedStompExecution {
  requestId: string
  timeout: number
  startTime: number
  startedAt: string
  resolvedUrl: string
  stompVersion: '1.1' | '1.2'
  connectHeaders: Record<string, string>
  subscriptions: StompSubscriptionConfig[]
  sendDestination: string
  sendBody: string
  sendHeaders: Record<string, string>
}

/** Parse a `heart-beat` header (`"<cx>,<cy>"`) into its two integers,
 * defaulting to `0,0` (no heart-beat) for a missing/malformed header. */
function parseHeartBeat(value: string | undefined): { x: number; y: number } {
  const [xRaw, yRaw] = (value ?? '0,0').split(',')
  const x = Number.parseInt(xRaw ?? '0', 10)
  const y = Number.parseInt(yRaw ?? '0', 10)
  return { x: Number.isFinite(x) && x >= 0 ? x : 0, y: Number.isFinite(y) && y >= 0 ? y : 0 }
}

/** Serialize a received frame to the message model, pulling the `subscription`
 * / `destination` headers up as first-class fields (the streaming list groups
 * by them). */
function toReceivedMessage(frame: StompFrame): StompMessage {
  return {
    direction: 'received',
    command: frame.command,
    ...(frame.headers['subscription'] !== undefined ? { subscription: frame.headers['subscription'] } : {}),
    ...(frame.headers['destination'] !== undefined ? { destination: frame.headers['destination'] } : {}),
    headers: frame.headers,
    body: frame.body,
    timestamp: new Date().toISOString()
  }
}

function toSentMessage(frame: StompFrame): StompMessage {
  return {
    direction: 'sent',
    command: frame.command,
    ...(frame.headers['destination'] !== undefined ? { destination: frame.headers['destination'] } : {}),
    headers: frame.headers,
    body: frame.body,
    timestamp: new Date().toISOString()
  }
}

/**
 * Service for executing STOMP (over WebSocket) requests in the main process.
 */
class StompExecutionService {
  private activeConnections = new Map<string, ActiveStompConnection>()

  /** Resolve a request into the everything-resolved shape, hydrating secrets.
   * `connectHeaders` and `sendHeaders` are merged into the SAME registered
   * `headers` keyValueGroup slot (by the tab view's `registerRequest` call) so
   * `collectRequestSecrets` sees both for pre-hydration — see
   * `StompRequestTabView` for the registration side. */
  private async resolveExecution(requestId: string, timeout: number): Promise<ResolvedStompExecution> {
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

    const fd = requestContext?.fullData as {
      stompVersion?: '1.1' | '1.2'
      connectHeaders?: { key: string; value: unknown; enabled?: boolean }[]
      subscriptions?: { id?: string; destination?: string; ackMode?: string }[]
      sendDestination?: string
      sendBody?: string
      sendHeaders?: { key: string; value: unknown; enabled?: boolean }[]
    } | undefined

    const resolveHeaders = (rows: { key: string; value: unknown; enabled?: boolean }[] | undefined): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const h of rows ?? []) {
        if (h.enabled === false || !h.key) continue
        out[h.key] = contextService.resolveKeyValueForRequest(h as Parameters<typeof contextService.resolveKeyValueForRequest>[0], requestId)
      }
      return out
    }

    const subscriptions: StompSubscriptionConfig[] = (fd?.subscriptions ?? [])
      .filter((s): s is { id: string; destination: string; ackMode?: string } => typeof s.id === 'string' && s.id !== '' && typeof s.destination === 'string' && s.destination !== '')
      .map((s) => ({
        id: s.id,
        destination: contextService.resolveValue(s.destination, requestId),
        ackMode: s.ackMode === 'client' || s.ackMode === 'client-individual' ? s.ackMode : 'auto'
      }))

    return {
      requestId,
      timeout,
      startTime,
      startedAt,
      resolvedUrl,
      stompVersion: fd?.stompVersion === '1.1' ? '1.1' : '1.2',
      connectHeaders: resolveHeaders(fd?.connectHeaders),
      subscriptions,
      sendDestination: fd?.sendDestination ? contextService.resolveValue(fd.sendDestination, requestId) : '',
      sendBody: fd?.sendBody ? contextService.resolveValue(fd.sendBody, requestId) : '',
      sendHeaders: resolveHeaders(fd?.sendHeaders)
    }
  }

  /** Open the raw `ws` connection + do the CONNECT/CONNECTED handshake +
   * SUBSCRIBE every configured destination. Shared by `execute()` and
   * `connectStreamingStomp()`. `onFrame` gets every frame the broker sends
   * AFTER the handshake settles (CONNECTED itself is not re-delivered).
   */
  private open(
    resolved: ResolvedStompExecution,
    callbacks: {
      onConnected: () => void
      onFrame: (frame: StompFrame) => void
      onClose: (error?: string) => void
    }
  ): { conn: ActiveStompConnection; ws: WebSocket } {
    const { requestId, resolvedUrl } = resolved
    // Electron's `ws` only accepts self-signed certs against `wss://` when
    // told to — acceptable for connecting to a local/dev/test broker (e.g.
    // the docker ActiveMQ mock), not a hardening concern for a client tool.
    const wsOptions = resolvedUrl.startsWith('wss://') ? { rejectUnauthorized: false } : {}
    // User-initiated connect — pre-authorise it so the firewall interceptor
    // sees the raw-socket connect as `allow`, mirroring the HTTP/WS runners.
    // Must OFFER the STOMP subprotocol: ActiveMQ / Spring brokers negotiate a
    // `vNN.stomp` subprotocol on their STOMP-over-WebSocket connector, and `ws`
    // hard-rejects a server-offered subprotocol the client never requested
    // ("Server sent a subprotocol but none was requested" → close 1006) —
    // without this the handshake never reaches CONNECTED.
    const ws = withFirewallBypassSync(() => new WebSocket(resolvedUrl, ['v12.stomp', 'v11.stomp', 'v10.stomp'], wsOptions))
    const conn: ActiveStompConnection = { requestId, ws, connected: false, subscriptions: resolved.subscriptions, startTime: resolved.startTime, messages: [] }
    this.activeConnections.set(requestId, conn)

    let handshakeDone = false
    let closed = false
    const closeWith = (error?: string): void => {
      if (closed) return
      closed = true
      if (conn.heartbeatTimer) clearInterval(conn.heartbeatTimer)
      this.activeConnections.delete(requestId)
      callbacks.onClose(error)
    }

    const sendFrame = (frame: StompFrame, record = true): void => {
      const wire = encodeStompFrame(frame)
      ws.send(wire)
      if (record) {
        const msg = toSentMessage(frame)
        conn.messages.push(msg)
        this.broadcastMessage(requestId, msg)
      }
    }

    ws.on('open', () => {
      sendFrame({
        command: 'CONNECT',
        headers: {
          'accept-version': resolved.stompVersion,
          host: (() => { try { return new URL(resolvedUrl).host } catch { return '/' } })(),
          'heart-beat': '10000,10000',
          ...resolved.connectHeaders
        },
        body: ''
      })
    })

    ws.on('message', (data: WebSocket.Data) => {
      // `ws` fragments a large message into `Buffer[]` and hands raw
      // `ArrayBuffer`s when the socket is configured for binary frames —
      // neither stringifies meaningfully via `String()` (that produced
      // `[object Object]` / `[object ArrayBuffer]`, silently corrupting the
      // frame text). Handle every branch of `WebSocket.Data` explicitly.
      const text = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8')
      for (const frame of parseStompFrames(text)) {
        if (!handshakeDone) {
          if (frame.command === 'CONNECTED') {
            handshakeDone = true
            conn.connected = true
            const msg = toReceivedMessage(frame)
            conn.messages.push(msg)
            this.broadcastMessage(requestId, msg)
            // Heart-beat negotiation (spec: `heart-beat:<sx>,<sy>` on the
            // server's CONNECTED — `sx` is the server's OWN send guarantee,
            // `sy` is what it wants to RECEIVE from us). Our outgoing
            // interval is max(our own guarantee, the server's `sy`); only
            // arm the timer when the server actually asked for heartbeats
            // (`sy > 0` — `sx` says nothing about what WE should send).
            const server = parseHeartBeat(frame.headers['heart-beat'])
            const outgoingMs = Math.max(10000, server.y)
            if (server.y > 0) {
              conn.heartbeatTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('\n')
              }, outgoingMs)
            }
            for (const sub of resolved.subscriptions) {
              sendFrame({ command: 'SUBSCRIBE', headers: { id: sub.id, destination: sub.destination, ack: sub.ackMode }, body: '' })
            }
            callbacks.onConnected()
          } else if (frame.command === 'ERROR') {
            const msg = toReceivedMessage(frame)
            conn.messages.push(msg)
            this.broadcastMessage(requestId, msg)
            closeWith((frame.body || frame.headers['message']) ?? 'STOMP CONNECT rejected')
          }
          continue
        }
        const msg = toReceivedMessage(frame)
        conn.messages.push(msg)
        this.broadcastMessage(requestId, msg)
        if (frame.command === 'ERROR') { closeWith((frame.body || frame.headers['message']) ?? 'STOMP error frame'); continue }
        callbacks.onFrame(frame)
      }
    })
    ws.on('close', () => { closeWith(handshakeDone ? undefined : 'Connection closed before CONNECTED') })
    ws.on('error', (err: Error) => { closeWith(err.message || 'Connection error') })

    // Expose `sendFrame` on the connection object via closures captured by the
    // public send/ack/nack/disconnect methods below (keyed by requestId).
    this.frameSenders.set(requestId, sendFrame)
    return { conn, ws }
  }

  /** Per-connection frame sender, set by {@link open} and read by the public
   * send/ack/nack/disconnect methods. Kept out of {@link ActiveStompConnection}
   * itself so that interface stays a plain data shape. */
  private frameSenders = new Map<string, (frame: StompFrame, record?: boolean) => void>()

  /**
   * One-shot execution (the request panel's Connect button): connect,
   * subscribe, optionally SEND the configured message once on open, then stay
   * open until `timeout` elapses or the caller disconnects — resolving with
   * everything exchanged, mirroring `WebSocketExecutionService.execute`
   * (raw-WS path)'s auto-timeout-close model. `send()` remains usable while
   * this promise is pending (before it resolves), for the Send button.
   */
  async execute(input: StompExecutionInput): Promise<StompExecutionResult> {
    const { requestId, timeout = DEFAULT_WS_TIMEOUT_MS } = input
    const startedAt = new Date().toISOString()
    const startTime = Date.now()

    let resolved: ResolvedStompExecution
    try {
      resolved = await this.resolveExecution(requestId, timeout)
    } catch (err) {
      return { requestId, success: false, connected: false, messages: [], error: (err as Error).message, timings: { startedAt, durationMs: Date.now() - startTime } }
    }

    this.broadcastProgress(requestId, 'started')
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: StompExecutionResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        this.persistHistory(requestId, result)
        resolve(result)
      }
      const { conn } = this.open(resolved, {
        onConnected: () => {
          if (resolved.sendDestination) {
            this.send(requestId, resolved.sendBody, resolved.sendDestination, resolved.sendHeaders)
          }
        },
        onFrame: () => { /* frames accumulate on `conn.messages`; read at close */ },
        onClose: (error) => {
          this.broadcastProgress(requestId, error ? 'error' : 'completed')
          finish({
            requestId,
            success: conn.connected && error === undefined,
            connected: conn.connected,
            messages: conn.messages,
            ...(error !== undefined ? { error } : {}),
            requestUrl: resolved.resolvedUrl,
            timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
          })
        }
      })
      const timeoutId = setTimeout(() => { this.disconnect(requestId) }, timeout)
    })
  }

  /**
   * Open a long-lived STOMP connection for the scenario engine's
   * `stompConnect` node: `onConnect` once CONNECTED + every SUBSCRIBE is
   * issued, `onMessage(undefined, payload)` for every received MESSAGE/ERROR
   * frame (STOMP frames have no named "event", so the event arg mirrors raw
   * WebSocket's always-`undefined`; the frame's own shape — command,
   * subscription, destination, headers, body — IS the payload), `onClose`
   * once it ends. Mirrors `WebSocketExecutionService.connectStreamingRaw`.
   */
  connectStreamingStomp(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false }

    void (async () => {
      let resolved: ResolvedStompExecution
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_WS_TIMEOUT_MS)
      } catch (err) {
        input.onClose((err as Error).message)
        return
      }
      if (ctl.closedByCaller) { input.onClose(); return }
      this.broadcastProgress(requestId, 'started')
      const { conn } = this.open(resolved, {
        onConnected: () => { input.onConnect() },
        onFrame: (frame) => { input.onMessage(undefined, toReceivedMessage(frame)) },
        onClose: (error) => {
          this.broadcastProgress(requestId, error ? 'error' : 'completed')
          if (conn.startTime > 0) {
            this.persistHistory(requestId, {
              requestId,
              success: conn.connected && error === undefined,
              connected: conn.connected,
              messages: conn.messages,
              ...(error !== undefined ? { error } : {}),
              requestUrl: resolved.resolvedUrl,
              timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
            })
          }
          input.onClose(error)
        }
      })
    })()

    return {
      // The scenario `stompSend` node has no destination/headers of its own —
      // it sends the bound request's configured `sendDestination`, with the
      // wired `payload` as the body (mirrors raw WebSocket's channel-less send).
      send: (_channel, payload) => this.sendUsingRequestDefaults(requestId, payload),
      close: () => { ctl.closedByCaller = true; this.disconnect(requestId) },
      isOpen: () => this.isActive(requestId)
    }
  }

  /** Send using the bound request's OWN configured destination/headers (the
   * scenario `stompSend` node has no separate destination input). */
  private sendUsingRequestDefaults(requestId: string, body: string): boolean {
    const conn = this.activeConnections.get(requestId)
    if (!conn?.connected) return false
    const requestContext = contextService.getRequestContext(requestId)
    const fd = requestContext?.fullData as { sendDestination?: string } | undefined
    const destination = fd?.sendDestination ? contextService.resolveValue(fd.sendDestination, requestId) : ''
    if (!destination) return false
    return this.send(requestId, body, destination)
  }

  /** SEND a message on an active connection. `destination` defaults to the
   * resolved `sendDestination` already captured at connect time when the
   * caller doesn't override it (the request panel's Send button always sends
   * to its own configured destination). */
  send(requestId: string, body: string, destination?: string, extraHeaders?: Record<string, string>): boolean {
    const conn = this.activeConnections.get(requestId)
    const sendFrame = this.frameSenders.get(requestId)
    if (!conn?.connected || !sendFrame) return false
    const dest = destination && destination !== '' ? destination : undefined
    if (!dest) return false
    sendFrame({ command: 'SEND', headers: { destination: dest, ...extraHeaders }, body })
    return true
  }

  /** ACK a single message (client / client-individual ack mode). */
  ack(requestId: string, messageId: string, subscriptionId: string): boolean {
    const sendFrame = this.frameSenders.get(requestId)
    const conn = this.activeConnections.get(requestId)
    if (!conn?.connected || !sendFrame) return false
    sendFrame({ command: 'ACK', headers: { id: messageId, subscription: subscriptionId }, body: '' })
    return true
  }

  /** NACK a single message (client / client-individual ack mode) — tells the
   * broker delivery failed (it may redeliver per its policy). */
  nack(requestId: string, messageId: string, subscriptionId: string): boolean {
    const sendFrame = this.frameSenders.get(requestId)
    const conn = this.activeConnections.get(requestId)
    if (!conn?.connected || !sendFrame) return false
    sendFrame({ command: 'NACK', headers: { id: messageId, subscription: subscriptionId }, body: '' })
    return true
  }

  /** End an active connection: send DISCONNECT (graceful — lets the broker
   * settle in-flight acks) then close the socket. Idempotent. */
  disconnect(requestId: string): boolean {
    const conn = this.activeConnections.get(requestId)
    if (!conn) return false
    const sendFrame = this.frameSenders.get(requestId)
    try {
      if (conn.connected && sendFrame) sendFrame({ command: 'DISCONNECT', headers: {}, body: '' })
    } catch {
      // best-effort
    }
    // Drop the outgoing heart-beat SYNCHRONOUSLY. Its usual home is the
    // socket's `close` handler, which only runs once the event loop delivers
    // that event — on the quit path it never does, and a live `setInterval`
    // then outlives the caller that asked for the connection to end.
    if (conn.heartbeatTimer) {
      clearInterval(conn.heartbeatTimer)
      delete conn.heartbeatTimer
    }
    try { conn.ws.close() } catch { /* already closed */ }
    return true
  }

  /** Whether a connection is currently active. */
  isActive(requestId: string): boolean {
    return this.activeConnections.get(requestId)?.connected ?? false
  }

  /** Snapshot the frame buffer for an active connection (MCP `read_stream`-style
   * consumers, mirrors `WebSocketExecutionService.getMessages`). */
  getMessages(requestId: string, afterIndex = 0): { frames: StompMessage[]; total: number } | null {
    const conn = this.activeConnections.get(requestId)
    if (!conn) return null
    const total = conn.messages.length
    const start = Math.max(0, Math.min(afterIndex, total))
    return { frames: conn.messages.slice(start), total }
  }

  /** Close every active connection (project-close / app-quit). */
  closeAll(): void {
    for (const requestId of [...this.activeConnections.keys()]) this.disconnect(requestId)
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('stomp:connection-progress', { requestId, status })
    }
  }

  private broadcastMessage(requestId: string, message: StompMessage): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('stomp:message', { requestId, message })
    }
  }

  /** Persist a finished connection to the response history (fire-and-forget)
   * so the response panel + a scenario `stompConnect` node's preview can read
   * the frames later. Failures are swallowed — history is best-effort. */
  private persistHistory(requestId: string, result: StompExecutionResult): void {
    void responseHistoryService.storeExecutionResult(requestId, 'stomp', result).catch(() => {
      logger.warn('[StompExecutionService] failed to persist history', { requestId })
    })
  }
}

/** Singleton instance */
export const stompExecutionService = new StompExecutionService()

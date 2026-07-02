/**
 * AMQP Execution Service
 *
 * Handles AMQP 0-9-1 (RabbitMQ) publish / subscribe / browse in the main
 * process using amqplib's promise API (2.x — no callback wrapping needed).
 * Connection, channel, and consumer are distinct amqplib objects with
 * distinct failure domains:
 *   - A CHANNEL protocol error (publishing to a non-existent exchange,
 *     consuming from a queue that doesn't exist, …) closes only that
 *     channel — the underlying connection stays open. `connectStreaming`
 *     recovers by recreating the channel and resuming the consumer, bounded
 *     by {@link AMQP_MAX_RECONNECT_ATTEMPTS}.
 *   - A CONNECTION-level drop (network blip, broker restart) is terminal
 *     here — the run settles with an error, same as a WebSocket connection
 *     drop with no reconnect configured. Scenario retry (the `retry` node)
 *     is the place to re-open the connection, not this service.
 *
 * `publish` and `browse` are one-shot (`execute`): connect, do the one
 * thing, close. `subscribe` is long-lived (`connectStreaming`), mirroring
 * `WebSocketExecutionService.connectStreamingMqtt` — used by both the tab
 * view's Connect action and the scenario `amqpConnect` node.
 */

import * as amqplib from 'amqplib'
import { BrowserWindow } from 'electron'
import { logger, withFirewallBypass } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { makeReconnectBudget } from './WebSocketExecutionService'
import {
  DEFAULT_AMQP_TIMEOUT_MS,
  DEFAULT_AMQP_BROWSE_PEEK_COUNT,
  AMQP_MAX_RECONNECT_ATTEMPTS
} from '../../shared/config/constants'
import type { AmqpMode } from '../../shared/types/requestPrimitives'

/** One AMQP frame — a sent publish or a received/peeked delivery. */
export interface AmqpMessage {
  direction: 'sent' | 'received'
  data: string
  exchange?: string
  routingKey?: string
  deliveryTag?: number
  /** Set on a `browse`-mode frame: peeked without acking, the queue is
   * unchanged. */
  peek?: boolean
  timestamp: string
}

/** AMQP execution result — shared shape for publish / browse (one-shot) and
 * the persisted-history snapshot of a subscribe session. */
export interface AmqpExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  mode: AmqpMode
  messages: AmqpMessage[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

export interface AmqpExecutionInput {
  requestId: string
  timeout?: number
}

/** Active subscribe connection — the connection model + its current channel
 * (recreated in place on a channel error, so `send` always targets the live
 * one). */
interface ActiveAmqpConnection {
  requestId: string
  model: amqplib.ChannelModel | null
  channel?: amqplib.Channel
  startTime: number
  messages: AmqpMessage[]
  /** The bound request's OWN exchange/routingKey — reused by a scenario
   * `amqpPublish` node that publishes on this connection (mirrors how
   * `mqttSend` reuses the connect node's topic). */
  exchange: string
  routingKey: string
}

interface ResolvedAmqpExecution {
  requestId: string
  timeout: number
  startTime: number
  startedAt: string
  resolvedUrl: string
  mode: AmqpMode
  exchange: string
  routingKey: string
  payload: string
  queue: string
  autoAck: boolean
  prefetch?: number
  browsePeekCount: number
}

/** Turn a connect failure into an actionable message, mirroring
 * `describeMqttConnectError` — amqplib's socket errors carry the same
 * Node.js `code` shape as any TCP client. */
export function describeAmqpConnectError(err: unknown, brokerUrl: string): string {
  const code = (err as { code?: string } | undefined)?.code
  const at = brokerUrl ? ` at ${brokerUrl}` : ''
  switch (code) {
    case 'ECONNREFUSED':
      return `Connection refused — no AMQP broker is listening${at}.`
    case 'ENOTFOUND':
      return `Host not found — the AMQP broker address${at} could not be resolved.`
    case 'ETIMEDOUT':
      return `Connection timed out — the AMQP broker${at} did not respond.`
    case 'ECONNRESET':
      return `Connection reset — the AMQP broker${at} closed the connection.`
    case 'ENETUNREACH':
      return `Network unreachable — cannot reach the AMQP broker${at}.`
    default:
      break
  }
  const message = (err as Error | undefined)?.message
  if (message) return `AMQP connection failed${at}: ${message}`
  return `AMQP connection failed${at}.`
}

/** Override the vhost / username / password on a resolved broker URL with the
 * request's own (separately Handlebars-resolved) fields — the ticket's UI
 * carries them as distinct inputs rather than requiring the user to hand-craft
 * the URL's userinfo + path. Falls back to the URL unmodified if it doesn't
 * parse (e.g. mid-typing with an unresolved `{{var}}`). */
export function applyAmqpConnectionOverrides(
  url: string,
  vhost: string | undefined,
  username: string | undefined,
  password: string | undefined
): string {
  try {
    const u = new URL(url)
    if (vhost !== undefined) u.pathname = `/${encodeURIComponent(vhost)}`
    if (username !== undefined) u.username = encodeURIComponent(username)
    if (password !== undefined) u.password = encodeURIComponent(password)
    return u.toString()
  } catch {
    return url
  }
}

class AMQPExecutionService {
  private activeConnections = new Map<string, ActiveAmqpConnection>()

  /** One-shot publish / browse, dispatched from the tab view's Send /
   * Browse button. `subscribe` is a long-lived connection — use
   * {@link connectStreaming} for it instead. */
  async execute(input: AmqpExecutionInput): Promise<AmqpExecutionResult> {
    const resolved = await this.resolveExecution(input.requestId, input.timeout ?? DEFAULT_AMQP_TIMEOUT_MS)
    if (resolved.mode === 'browse') return this.executeBrowse(resolved)
    if (resolved.mode === 'subscribe') {
      return {
        requestId: resolved.requestId,
        success: false,
        connected: false,
        mode: resolved.mode,
        messages: [],
        error: 'Subscribe is a long-lived connection — use Connect, not Send.',
        requestUrl: resolved.resolvedUrl,
        timings: { startedAt: resolved.startedAt, durationMs: 0 }
      }
    }
    return this.executePublish(resolved)
  }

  private async resolveExecution(requestId: string, timeout: number): Promise<ResolvedAmqpExecution> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      throw new Error('No resolved URL found for this request. Make sure the request is registered.')
    }
    let resolvedUrl = urlResult.resolvedUrl

    // Resolve any SecretValues reachable from the active env-folder chain
    // BEFORE reading the auth fields below (mirrors HTTP / WebSocket).
    const envSecrets = contextService.collectEnvironmentSecrets(requestId)
    if (envSecrets.length > 0) {
      await secretHydrationService.hydrate(requestId, envSecrets)
      contextService.refreshEnvironmentContext(requestId)
      resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? resolvedUrl
    }

    const fd = contextService.getRequestContext(requestId)?.fullData
    const resolveOpt = (v: string | undefined): string | undefined =>
      v !== undefined && v !== '' ? contextService.resolveValue(v, requestId) : undefined

    resolvedUrl = applyAmqpConnectionOverrides(resolvedUrl, resolveOpt(fd?.vhost), resolveOpt(fd?.username), resolveOpt(fd?.password))

    const mode: AmqpMode = fd?.mode ?? 'publish'
    const exchange = resolveOpt(fd?.exchange) ?? ''
    const routingKey = resolveOpt(fd?.routingKey) ?? ''
    const payload = fd?.payload !== undefined ? contextService.resolveValue(fd.payload, requestId) : ''
    const queue = resolveOpt(fd?.queue) ?? ''
    const autoAck = fd?.autoAck !== false
    const browsePeekCount = fd?.browsePeekCount ?? DEFAULT_AMQP_BROWSE_PEEK_COUNT

    return {
      requestId, timeout, startTime, startedAt, resolvedUrl, mode, exchange, routingKey, payload, queue, autoAck,
      ...(fd?.prefetch !== undefined ? { prefetch: fd.prefetch } : {}),
      browsePeekCount
    }
  }

  private async executePublish(resolved: ResolvedAmqpExecution): Promise<AmqpExecutionResult> {
    const { requestId, startTime, startedAt, resolvedUrl, exchange, routingKey, payload } = resolved
    const messages: AmqpMessage[] = []
    let model: amqplib.ChannelModel | undefined
    try {
      model = await withFirewallBypass(() => amqplib.connect(resolvedUrl, { timeout: resolved.timeout }))
      const channel = await model.createChannel()
      const sent = channel.publish(exchange, routingKey, Buffer.from(payload))
      const msg: AmqpMessage = { direction: 'sent', data: payload, exchange, routingKey, timestamp: new Date().toISOString() }
      messages.push(msg)
      this.broadcastMessage(requestId, msg)
      await channel.close()
      await model.close()
      const result: AmqpExecutionResult = {
        requestId,
        success: sent,
        connected: true,
        mode: 'publish',
        messages,
        ...(sent ? {} : { error: 'The broker applied back-pressure (channel write buffer full) — resend once it drains.' }),
        requestUrl: resolvedUrl,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
      this.persistHistory(requestId, result)
      return result
    } catch (err) {
      try { await model?.close() } catch { /* already closed */ }
      const result: AmqpExecutionResult = {
        requestId, success: false, connected: false, mode: 'publish', messages,
        error: describeAmqpConnectError(err, resolvedUrl), requestUrl: resolvedUrl,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
      this.persistHistory(requestId, result)
      return result
    }
  }

  /**
   * Peek up to `browsePeekCount` messages off `queue` WITHOUT consuming them.
   * amqplib's `channel.get()` has no cursor/offset API, so this loops it:
   * each call dequeues the NEXT message and marks it delivered-but-unacked on
   * this channel (it does not go back to other consumers meanwhile). Once the
   * loop ends, a SINGLE `nack(..., allUpTo: true, requeue: true)` on the last
   * message puts every peeked message back at once — nacking after each
   * individual `get()` would risk RabbitMQ redelivering it before the next
   * `get()` runs, corrupting the peek.
   */
  private async executeBrowse(resolved: ResolvedAmqpExecution): Promise<AmqpExecutionResult> {
    const { requestId, startTime, startedAt, resolvedUrl, queue, browsePeekCount } = resolved
    const messages: AmqpMessage[] = []
    let model: amqplib.ChannelModel | undefined
    try {
      if (!queue) throw new Error('Browse mode requires a queue name.')
      model = await withFirewallBypass(() => amqplib.connect(resolvedUrl, { timeout: resolved.timeout }))
      const channel = await model.createChannel()
      const collected: amqplib.GetMessage[] = []
      for (let i = 0; i < browsePeekCount; i++) {
        const got = await channel.get(queue, { noAck: false })
        if (got === false) break
        collected.push(got)
        const record: AmqpMessage = {
          direction: 'received',
          data: got.content.toString('utf8'),
          exchange: got.fields.exchange,
          routingKey: got.fields.routingKey,
          deliveryTag: got.fields.deliveryTag,
          peek: true,
          timestamp: new Date().toISOString()
        }
        messages.push(record)
        this.broadcastMessage(requestId, record)
      }
      if (collected.length > 0) {
        channel.nack(collected[collected.length - 1], true, true)
      }
      await channel.close()
      await model.close()
      const result: AmqpExecutionResult = {
        requestId, success: true, connected: true, mode: 'browse', messages,
        requestUrl: resolvedUrl, timings: { startedAt, durationMs: Date.now() - startTime }
      }
      this.persistHistory(requestId, result)
      return result
    } catch (err) {
      try { await model?.close() } catch { /* already closed */ }
      const result: AmqpExecutionResult = {
        requestId, success: false, connected: false, mode: 'browse', messages,
        error: describeAmqpConnectError(err, resolvedUrl), requestUrl: resolvedUrl,
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
      this.persistHistory(requestId, result)
      return result
    }
  }

  /**
   * Open a long-lived AMQP connection + consumer for the scenario engine
   * (and the tab view's Connect action) and stream received frames through
   * callbacks: `onConnect` once the consumer is registered, `onMessage` for
   * every delivered message (payload already parsed from the wire), and
   * `onClose` once the connection ends. Registers the connection in the
   * active map (so `send` / `disconnect` / the UI beam all work) and returns
   * a handle to publish on it + close it.
   *
   * A channel PROTOCOL error (bad queue name) closes only the channel; this
   * recreates the channel and resumes consuming, bounded by
   * {@link AMQP_MAX_RECONNECT_ATTEMPTS}. A connection-level drop is terminal.
   */
  connectStreaming(input: {
    requestId: string
    onConnect: () => void
    onMessage: (routingKey: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, connected: false, startTime: 0, startedAt: '', url: '' }
    // Read through a function (rather than the bare property) so TS's
    // flow analysis can't narrow it to a stale literal across the `await`s
    // below — `close()` (returned to the caller) can flip it from a
    // separate closure while this IIFE is suspended mid-connect.
    const isClosedByCaller = (): boolean => ctl.closedByCaller
    const frames: AmqpMessage[] = []
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      if (ctl.startTime > 0) {
        this.persistHistory(requestId, {
          requestId,
          success: ctl.connected && error === undefined,
          connected: ctl.connected,
          mode: 'subscribe',
          messages: frames,
          ...(error !== undefined ? { error } : {}),
          requestUrl: ctl.url,
          timings: { startedAt: ctl.startedAt, durationMs: Date.now() - ctl.startTime }
        })
      }
      input.onClose(error)
    }
    const settle = (error?: string): void => {
      this.activeConnections.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      fireClose(error)
    }

    void (async () => {
      let resolved: ResolvedAmqpExecution
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_AMQP_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (isClosedByCaller()) { fireClose(); return }
      ctl.startTime = resolved.startTime
      ctl.startedAt = resolved.startedAt
      ctl.url = resolved.resolvedUrl

      if (!resolved.queue) { fireClose('Subscribe mode requires a queue name.'); return }

      const connection: ActiveAmqpConnection = {
        requestId, model: null, startTime: resolved.startTime, messages: frames,
        exchange: resolved.exchange, routingKey: resolved.routingKey
      }
      // Bounded recovery for CHANNEL-level protocol errors only — a full
      // connection drop is terminal (see the class doc comment).
      const channelErrorBudget = makeReconnectBudget(AMQP_MAX_RECONNECT_ATTEMPTS)

      const setupChannel = async (model: amqplib.ChannelModel): Promise<void> => {
        const channel = await model.createChannel()
        connection.channel = channel
        if (resolved.prefetch !== undefined) await channel.prefetch(resolved.prefetch)
        channel.on('error', (err: Error) => {
          if (channelErrorBudget.onReconnect()) {
            settle(`AMQP channel kept failing (${err.message}) — gave up after ${AMQP_MAX_RECONNECT_ATTEMPTS} attempts.`)
            return
          }
          logger.warn('[AMQPExecutionService] channel error, recreating channel', { requestId, error: err.message })
          void setupChannel(model).catch((e: unknown) => { settle(e instanceof Error ? e.message : String(e)) })
        })
        await channel.consume(resolved.queue, (msg: amqplib.ConsumeMessage | null) => {
          if (msg === null) return // the broker cancelled this consumer
          channelErrorBudget.onConnect() // a live delivery resets the error budget
          const data = msg.content.toString('utf8')
          const frame: AmqpMessage = {
            direction: 'received', data, exchange: msg.fields.exchange, routingKey: msg.fields.routingKey,
            deliveryTag: msg.fields.deliveryTag, timestamp: new Date().toISOString()
          }
          frames.push(frame)
          this.broadcastMessage(requestId, frame)
          if (!resolved.autoAck) channel.ack(msg)
          let parsed: unknown
          try { parsed = JSON.parse(data) } catch { parsed = data }
          input.onMessage(msg.fields.routingKey, parsed)
        }, { noAck: resolved.autoAck })
      }

      try {
        // User-initiated connect — pre-authorise it so the firewall
        // interceptor allows it, mirroring the WebSocket / MQTT connect path.
        const model = await withFirewallBypass(() => amqplib.connect(resolved.resolvedUrl, { timeout: resolved.timeout }))
        if (isClosedByCaller()) { try { await model.close() } catch { /* already closed */ } fireClose(); return }
        connection.model = model
        this.activeConnections.set(requestId, connection)
        model.on('error', (err: Error) => {
          if (!ctl.connected) settle(describeAmqpConnectError(err, resolved.resolvedUrl))
        })
        model.on('close', () => { settle() })
        await setupChannel(model)
        ctl.connected = true
        logger.info('[AMQPExecutionService] Connected (subscribe)', { requestId, queue: resolved.queue })
        this.broadcastProgress(requestId, 'started')
        input.onConnect()
      } catch (err) {
        fireClose((err as Error).message || 'Connection failed')
      }
    })()

    return {
      send: (payload) => this.send(requestId, payload),
      close: () => { ctl.closedByCaller = true; this.disconnect(requestId) },
      isOpen: () => this.isActive(requestId)
    }
  }

  /** Publish on an already-open subscribe connection's channel, to the bound
   * request's OWN exchange/routingKey — the scenario `amqpPublish` node's
   * path, mirroring `mqttSend` reusing the connect node's topic. */
  send(requestId: string, payload: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection?.channel) return false
    const sent = connection.channel.publish(connection.exchange, connection.routingKey, Buffer.from(payload))
    const msg: AmqpMessage = {
      direction: 'sent', data: payload, exchange: connection.exchange, routingKey: connection.routingKey,
      timestamp: new Date().toISOString()
    }
    connection.messages.push(msg)
    this.broadcastMessage(requestId, msg)
    return sent
  }

  /** Disconnect an active (subscribe) connection. */
  disconnect(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return false
    logger.info('[AMQPExecutionService] Disconnecting', { requestId })
    void connection.model?.close().catch(() => { /* already closed */ })
    return true
  }

  /** Abort an in-flight execution — same as {@link disconnect} for this
   * protocol (a one-shot publish/browse doesn't leave an active-connection
   * entry to cancel; it either finishes or times out on its own). */
  cancel(requestId: string): boolean {
    return this.disconnect(requestId)
  }

  isActive(requestId: string): boolean {
    return this.activeConnections.has(requestId)
  }

  /** Tear down every active connection — called on project close / app quit,
   * mirroring `WebSocketExecutionService.closeAll`. Awaits each broker
   * connection's own close (unlike `disconnect`, which is fire-and-forget)
   * so a caller awaiting this knows the OS sockets are actually released. */
  async closeAll(): Promise<void> {
    const requestIds = [...this.activeConnections.keys()]
    if (requestIds.length === 0) return
    await Promise.all(requestIds.map(async (requestId) => {
      const connection = this.activeConnections.get(requestId)
      try { await connection?.model?.close() } catch { /* already closed */ }
    }))
    logger.info('[AMQPExecutionService] Closed all connections', { count: requestIds.length })
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amqp:connection-progress', { requestId, status })
    }
  }

  private broadcastMessage(requestId: string, message: AmqpMessage): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amqp:message', { requestId, message })
    }
  }

  private persistHistory(requestId: string, result: AmqpExecutionResult): void {
    void responseHistoryService.storeExecutionResult(requestId, 'amqp', result).catch(() => {
      // best-effort; a history write must never surface as a connection error
    })
  }
}

/** Singleton instance */
export const amqpExecutionService = new AMQPExecutionService()

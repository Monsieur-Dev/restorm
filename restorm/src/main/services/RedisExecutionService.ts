/**
 * Redis Execution Service
 *
 * Handles Redis pub/sub + common commands in the main process. Unlike every
 * other streaming/unary split in this codebase, BOTH shapes live on the SAME
 * request type here: `mode === 'subscribe'` opens a long-lived subscriber
 * connection (mirrors the WebSocket/MQTT connect pattern), `mode ===
 * 'command'` runs a single command on a fresh client and disconnects (mirrors
 * an HTTP request). The two paths never share a client — ioredis forbids
 * running regular commands on a client that has entered subscriber mode.
 */

import Redis from 'ioredis'
import { BrowserWindow } from 'electron'
import { logger, withFirewallBypassSync } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_REDIS_TIMEOUT_MS } from '../../shared/config/constants'
import { parseFreeformCommand, capXreadBlockMs, formatRedisReply, describeRedisConnectError } from '../../shared/utils/redisCommand'

/** Redis request execution input */
export interface RedisExecutionInput {
  requestId: string
  timeout?: number
}

/** One pub/sub message (subscribe mode) */
export interface RedisMessage {
  direction: 'sent' | 'received'
  channel?: string
  data: string
  timestamp: string
}

/** Redis response result — covers BOTH modes; `mode` discriminates which
 * fields apply. */
export interface RedisExecutionResult {
  requestId: string
  success: boolean
  mode: 'subscribe' | 'command'
  requestUrl?: string
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  // Subscribe mode.
  connected?: boolean
  channels?: string[]
  messages?: RedisMessage[]
  // Command mode.
  command?: string
  args?: string[]
  reply?: string
}

/** Active connection: a subscribe-mode client (long-lived) or an in-flight
 * command-mode client (torn down as soon as the command settles). */
interface ActiveConnection {
  requestId: string
  kind: 'subscribe' | 'command'
  client: Redis
  startTime: number
  channels?: string[]
  messages: RedisMessage[]
}

/** Resolved inputs shared by both modes. */
interface ResolvedExecution {
  requestId: string
  timeout: number
  startTime: number
  startedAt: string
  resolvedUrl: string
  password: string | undefined
  mode: 'subscribe' | 'command'
  channels: string[]
  command: string | undefined
  args: string[]
  freeformCommand: string | undefined
}

class RedisExecutionService {
  private activeConnections = new Map<string, ActiveConnection>()

  /**
   * SUBSCRIBE MODE: open a dedicated subscriber client and stay connected
   * until {@link disconnect}. Resolves once the session ENDS (mirrors
   * `WebSocketExecutionService.executeMqtt`) — the caller (the IPC handler)
   * awaits it for the terminal history entry; live messages stream to the
   * renderer via the `redis:message` broadcast independently of this promise.
   * A SECOND history entry is persisted immediately on a successful
   * subscribe (in addition to the terminal one on close) so an MCP
   * `run_request` — which waits for a NEW history entry — doesn't block for
   * the connection's whole lifetime.
   */
  subscribe(input: RedisExecutionInput): Promise<RedisExecutionResult> {
    const { requestId } = input
    return new Promise((resolve) => {
      // Optional: `finish` can run before `resolveExecution` settles (e.g. it
      // rejects) — the `resolved?.` reads below are a real possibility, not a
      // type-narrowing artifact.
      let resolved: ResolvedExecution | undefined
      const messages: RedisMessage[] = []
      let connected = false
      let settled = false

      const finish = (success: boolean, error?: string): void => {
        if (settled) return
        settled = true
        this.activeConnections.delete(requestId)
        this.broadcastProgress(requestId, error ? 'error' : 'completed')
        const result: RedisExecutionResult = {
          requestId,
          success,
          mode: 'subscribe',
          connected,
          channels: resolved?.channels ?? [],
          messages,
          ...(error ? { error } : {}),
          requestUrl: resolved?.resolvedUrl,
          timings: { startedAt: resolved?.startedAt ?? new Date().toISOString(), durationMs: Date.now() - (resolved?.startTime ?? Date.now()) }
        }
        this.persistHistory(requestId, result)
        resolve(result)
      }

      void (async () => {
        try {
          resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_REDIS_TIMEOUT_MS)
        } catch (err) {
          finish(false, (err as Error).message)
          return
        }
        if (resolved.channels.length === 0) {
          finish(false, 'No channels to subscribe to.')
          return
        }

        this.broadcastProgress(requestId, 'started')

        let client: Redis
        try {
          // User-initiated connect — pre-authorise (see WebSocketExecutionService).
          client = withFirewallBypassSync(() => new Redis(resolved.resolvedUrl, {
            ...(resolved.password ? { password: resolved.password } : {}),
            connectTimeout: resolved.timeout,
            lazyConnect: false
          }))
        } catch (err) {
          finish(false, (err as Error).message || 'Connection failed')
          return
        }

        const connection: ActiveConnection = { requestId, kind: 'subscribe', client, startTime: resolved.startTime, channels: resolved.channels, messages }
        this.activeConnections.set(requestId, connection)

        const connectTimer = setTimeout(() => {
          if (!connected) {
            try { client.disconnect() } catch { /* already closed */ }
            finish(false, `Connection timed out — the Redis server${resolved.resolvedUrl ? ` at ${resolved.resolvedUrl}` : ''} did not respond.`)
          }
        }, resolved.timeout)

        client.on('ready', () => {
          clearTimeout(connectTimer)
          void client.subscribe(...resolved.channels).then(() => {
            connected = true
            logger.info('[RedisExecutionService] Subscribed', { requestId, channels: resolved.channels })
            // Persist a CONNECT-time entry so a caller polling for a new history
            // entry (e.g. MCP run_request) doesn't block for the whole session.
            this.persistHistory(requestId, {
              requestId,
              success: true,
              mode: 'subscribe',
              connected: true,
              channels: resolved.channels,
              messages: [],
              requestUrl: resolved.resolvedUrl,
              timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
            })
          }).catch((err: unknown) => {
            finish(false, describeRedisConnectError(err, resolved.resolvedUrl))
          })
        })

        client.on('message', (channel: string, data: string) => {
          const msg: RedisMessage = { direction: 'received', channel, data, timestamp: new Date().toISOString() }
          messages.push(msg)
          this.broadcastMessage(requestId, msg)
        })

        client.on('error', (err: Error) => {
          if (!connected) {
            clearTimeout(connectTimer)
            finish(false, describeRedisConnectError(err, resolved.resolvedUrl))
          }
        })

        client.on('end', () => {
          clearTimeout(connectTimer)
          finish(connected)
        })
      })()
    })
  }

  /**
   * SUBSCRIBE MODE, scenario-engine variant: same connection as {@link
   * subscribe}, but exposes the scheduler's synchronous connect-handle
   * contract (`{ send, close, isOpen }` + connect/message/close callbacks)
   * instead of a promise that resolves on close — mirrors
   * `WebSocketExecutionService.connectStreamingMqtt`. Redis pub/sub has no
   * send from a `redisSubscribe` node (PUBLISH is a command-mode run), so
   * `send` is a permanent no-op, matching the GraphQL-subscription handle.
   * Shares `activeConnections` / `broadcastProgress` / `broadcastMessage` /
   * `persistHistory` with the IPC path, so a scenario-driven connection is
   * ALSO visible live in the request panel if its tab happens to be open.
   */
  connectStreaming(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    let resolved: ResolvedExecution | undefined
    const messages: RedisMessage[] = []
    let connected = false
    // `fired` / `closedByCaller` live on a mutable object rather than plain
    // `let`s — both are set only from sibling closures (event handlers, the
    // returned `close()`), and TS's flow analysis narrows a closure-captured
    // `let` to its literal initial value across an `await` in the SAME
    // function body (it can't see the sibling-closure mutation), which trips
    // `@typescript-eslint/no-unnecessary-condition` as dead code even though
    // a real Stop-during-resolve race can flip it. An object property isn't
    // narrowed the same way — see `GraphQLSubscriptionService.connectStreaming`
    // for the same pattern.
    const ctl = { fired: false, closedByCaller: false }
    let client: Redis | undefined

    const fireClose = (error?: string): void => {
      if (ctl.fired) return
      ctl.fired = true
      this.activeConnections.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      const result: RedisExecutionResult = {
        requestId,
        success: connected && error === undefined,
        mode: 'subscribe',
        connected,
        channels: resolved?.channels ?? [],
        messages,
        ...(error ? { error } : {}),
        requestUrl: resolved?.resolvedUrl,
        timings: { startedAt: resolved?.startedAt ?? new Date().toISOString(), durationMs: Date.now() - (resolved?.startTime ?? Date.now()) }
      }
      this.persistHistory(requestId, result)
      input.onClose(error)
    }

    void (async () => {
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_REDIS_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      // The caller (the scheduler, on a Stop) can invoke `close()` before this
      // resolve has even settled — bail out cleanly instead of opening a
      // connection the caller already considers closed.
      if (ctl.fired || ctl.closedByCaller) { fireClose(); return }
      if (resolved.channels.length === 0) {
        fireClose('No channels to subscribe to.')
        return
      }

      this.broadcastProgress(requestId, 'started')

      try {
        client = withFirewallBypassSync(() => new Redis(resolved.resolvedUrl, {
          ...(resolved.password ? { password: resolved.password } : {}),
          connectTimeout: resolved.timeout,
          lazyConnect: false
        }))
      } catch (err) {
        fireClose((err as Error).message || 'Connection failed')
        return
      }

      this.activeConnections.set(requestId, { requestId, kind: 'subscribe', client, startTime: resolved.startTime, channels: resolved.channels, messages })

      const connectTimer = setTimeout(() => {
        if (!connected) {
          try { client?.disconnect() } catch { /* already closed */ }
          fireClose(`Connection timed out — the Redis server${resolved?.resolvedUrl ? ` at ${resolved.resolvedUrl}` : ''} did not respond.`)
        }
      }, resolved.timeout)

      client.on('ready', () => {
        clearTimeout(connectTimer)
        void client?.subscribe(...(resolved?.channels ?? [])).then(() => {
          connected = true
          input.onConnect()
        }).catch((err: unknown) => {
          fireClose(describeRedisConnectError(err, resolved?.resolvedUrl ?? ''))
        })
      })

      client.on('message', (channel: string, data: string) => {
        const msg: RedisMessage = { direction: 'received', channel, data, timestamp: new Date().toISOString() }
        messages.push(msg)
        this.broadcastMessage(requestId, msg)
        let parsed: unknown
        try { parsed = JSON.parse(data) } catch { parsed = data }
        input.onMessage(channel, parsed)
      })

      client.on('error', (err: Error) => {
        if (!connected) {
          clearTimeout(connectTimer)
          fireClose(describeRedisConnectError(err, resolved?.resolvedUrl ?? ''))
        }
      })

      client.on('end', () => {
        clearTimeout(connectTimer)
        fireClose(connected ? undefined : 'Connection closed before it was ready.')
      })
    })()

    return {
      // Redis pub/sub has no send from a subscribe connection — PUBLISH is a
      // one-shot command-mode run, never routed through this handle.
      send: () => false,
      close: () => {
        if (ctl.fired) return
        ctl.closedByCaller = true
        try { client?.disconnect() } catch { /* not yet connected, or already closed */ }
      },
      isOpen: () => connected && !ctl.fired
    }
  }

  /**
   * COMMAND MODE: run ONE command on a FRESH client, then disconnect. Never
   * reuses the subscribe client — ioredis forbids regular commands once a
   * client has entered subscriber mode.
   */
  async runCommand(input: RedisExecutionInput): Promise<RedisExecutionResult> {
    const { requestId } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    let resolved: ResolvedExecution
    try {
      resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_REDIS_TIMEOUT_MS)
    } catch (err) {
      return this.finishCommand(requestId, startedAt, startTime, undefined, [], undefined, false, (err as Error).message)
    }

    const parts = resolved.freeformCommand && resolved.freeformCommand.trim() !== ''
      ? parseFreeformCommand(resolved.freeformCommand)
      : [resolved.command ?? '', ...resolved.args]
    const [commandName, ...rawArgs] = parts
    if (!commandName) {
      return this.finishCommand(requestId, startedAt, startTime, resolved.resolvedUrl, [], undefined, false, 'No command to run.')
    }
    const args = commandName.toUpperCase() === 'XREAD' ? capXreadBlockMs(rawArgs) : rawArgs

    let client: Redis
    try {
      client = withFirewallBypassSync(() => new Redis(resolved.resolvedUrl, {
        ...(resolved.password ? { password: resolved.password } : {}),
        connectTimeout: resolved.timeout,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null
      }))
    } catch (err) {
      return this.finishCommand(requestId, startedAt, startTime, resolved.resolvedUrl, [commandName, ...args], undefined, false, (err as Error).message || 'Connection failed')
    }

    this.activeConnections.set(requestId, { requestId, kind: 'command', client, startTime, messages: [] })
    this.broadcastProgress(requestId, 'started')

    try {
      await withFirewallBypassSync(() => client.connect())
      const reply: unknown = await client.call(commandName.toLowerCase(), ...args)
      const formatted = formatRedisReply(reply)
      logger.info('[RedisExecutionService] Command executed', { requestId, command: commandName })
      return this.finishCommand(requestId, startedAt, startTime, resolved.resolvedUrl, [commandName, ...args], formatted, true)
    } catch (err) {
      return this.finishCommand(requestId, startedAt, startTime, resolved.resolvedUrl, [commandName, ...args], undefined, false, describeRedisConnectError(err, resolved.resolvedUrl))
    } finally {
      try { client.disconnect() } catch { /* already closed */ }
      this.activeConnections.delete(requestId)
    }
  }

  private finishCommand(
    requestId: string,
    startedAt: string,
    startTime: number,
    requestUrl: string | undefined,
    commandParts: string[],
    reply: string | undefined,
    success: boolean,
    error?: string
  ): RedisExecutionResult {
    const [command, ...args] = commandParts
    this.broadcastProgress(requestId, error ? 'error' : 'completed')
    const result: RedisExecutionResult = {
      requestId,
      success,
      mode: 'command',
      ...(command !== undefined ? { command } : {}),
      args,
      ...(reply !== undefined ? { reply } : {}),
      ...(error ? { error } : {}),
      ...(requestUrl !== undefined ? { requestUrl } : {}),
      timings: { startedAt, durationMs: Date.now() - startTime }
    }
    this.persistHistory(requestId, result)
    return result
  }

  /** Abort an active connection: the subscribe client, or an in-flight
   * command client (cancels a blocked call before it settles). */
  disconnect(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return false
    logger.info('[RedisExecutionService] Disconnecting', { requestId, kind: connection.kind })
    try { connection.client.disconnect() } catch { /* already closed */ }
    return true
  }

  /** Alias for {@link disconnect} — the shape `PROTOCOL_EXECUTORS` expects. */
  cancel(requestId: string): boolean {
    return this.disconnect(requestId)
  }

  /** Whether a subscribe connection is currently open. */
  isActive(requestId: string): boolean {
    const connection = this.activeConnections.get(requestId)
    return connection?.kind === 'subscribe' && connection.client.status === 'ready'
  }

  /** Snapshot the message buffer for an active subscription. Mirrors
   * `WebSocketExecutionService.getMessages`. */
  getMessages(requestId: string, afterIndex = 0): { frames: RedisMessage[]; total: number } | null {
    const connection = this.activeConnections.get(requestId)
    if (!connection) return null
    const total = connection.messages.length
    const start = Math.max(0, Math.min(afterIndex, total))
    return { frames: connection.messages.slice(start), total }
  }

  /** Tear down every active connection — called on project close / app quit,
   * mirroring `WebSocketExecutionService.closeAll`. `disconnect()` is a
   * synchronous, forceful teardown (`client.disconnect()`, not the graceful
   * `client.quit()`), so there is nothing to await here — kept `Promise<void>`
   * to match the other protocols' `closeAll` signature callers already
   * `await`/`void` uniformly. */
  closeAll(): Promise<void> {
    for (const requestId of [...this.activeConnections.keys()]) {
      try { this.disconnect(requestId) } catch { /* best-effort teardown */ }
    }
    return Promise.resolve()
  }

  /** Resolve the request's connection + mode-specific fields through
   * `ContextService` — URL, password, channels, command, args ALL pass
   * through handlebars resolution before hitting the wire. */
  private async resolveExecution(requestId: string, timeout: number): Promise<ResolvedExecution> {
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

    const fd = requestContext?.fullData
    const resolveOpt = (v: string | undefined): string | undefined =>
      v !== undefined && v !== '' ? contextService.resolveValue(v, requestId) : undefined
    const resolveEach = (arr: string[] | undefined): string[] =>
      (arr ?? []).map((v) => contextService.resolveValue(v, requestId))

    const mode: 'subscribe' | 'command' = fd?.redisMode === 'subscribe' ? 'subscribe' : 'command'

    return {
      requestId,
      timeout,
      startTime,
      startedAt,
      resolvedUrl,
      password: resolveOpt(fd?.password),
      mode,
      channels: resolveEach(fd?.channels),
      command: fd?.command,
      args: resolveEach(fd?.args),
      freeformCommand: resolveOpt(fd?.freeformCommand)
    }
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('redis:connection-progress', { requestId, status })
    }
  }

  private broadcastMessage(requestId: string, message: RedisMessage): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('redis:message', { requestId, message })
    }
  }

  /** Persist a result to the response history (fire-and-forget) — see
   * `WebSocketExecutionService.persistHistory`. */
  private persistHistory(requestId: string, result: RedisExecutionResult): void {
    void responseHistoryService.storeExecutionResult(requestId, 'redis', result).catch(() => {
      // best-effort; a history write must never surface as a connection error
    })
  }
}

/** Singleton instance */
export const redisExecutionService = new RedisExecutionService()

/**
 * Kafka Execution Service
 *
 * Unlike every other protocol in Restorm, Kafka has NO single request→response
 * shape: `kafkajs` producer / consumer / admin objects are independent
 * lifecycle objects created fresh per run and torn down on completion —
 * there is no persistent per-request connection to reuse across calls. This
 * service exposes the three lifecycles the request model's `mode` selects:
 *
 *  - {@link produce}: one-shot (connect → send → disconnect), returns the
 *    RecordMetadata kafkajs reports.
 *  - {@link connectStreamingConsumer}: long-lived (connect → subscribe →
 *    eachMessage → stop/disconnect on cancel), mirrors the scenario engine's
 *    other streaming connects (`connectStreamingMqtt`).
 *  - {@link browse}: one-shot peek via an EPHEMERAL consumer group (never
 *    committed, never reused) — kafkajs's admin client has no raw
 *    fetch-messages API, so browsing without joining a durable group means
 *    a throwaway group id instead.
 */

import { randomUUID } from 'crypto'
import { Kafka, logLevel as KafkaLogLevel } from 'kafkajs'
import type { KafkaConfig, SASLOptions, Consumer, IHeaders } from 'kafkajs'
import { BrowserWindow } from 'electron'
import { logger, withFirewallBypass } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../shared/config/constants'
import type { KafkaFromOffset, KafkaSaslMechanism } from '../../shared/types/requests/KafkaRequest'

/** One produced/consumed/browsed Kafka record, in this service's own wire
 * shape (headers as a plain record — `ResponseHistoryService` maps this to
 * the KeyValue[] shape the history archive stores, mirroring how
 * `WebSocketExecutionService.WebSocketMessage` is a distinct local type from
 * `ResponseHistoryWebSocketMessage`). */
export interface KafkaMessageFrame {
  direction: 'received'
  topic: string
  partition: number
  offset: string
  key?: string
  value: string
  headers?: Record<string, string>
  timestamp: string
}

export interface KafkaExecutionInput {
  requestId: string
  timeout?: number
}

interface KafkaTimings {
  startedAt: string
  durationMs: number
}

export interface KafkaProduceResult {
  requestId: string
  success: boolean
  kafkaMode: 'produce'
  requestTopic: string
  requestUrl: string
  partition?: number
  offset?: string
  error?: string
  timings: KafkaTimings
}

export interface KafkaBrowseResult {
  requestId: string
  success: boolean
  kafkaMode: 'browse'
  requestTopic: string
  requestUrl: string
  messages: KafkaMessageFrame[]
  error?: string
  timings: KafkaTimings
}

export interface KafkaConsumeResult {
  requestId: string
  success: boolean
  kafkaMode: 'consume'
  requestTopic: string
  requestUrl: string
  connected: boolean
  messages: KafkaMessageFrame[]
  error?: string
  timings: KafkaTimings
}

export type KafkaExecutionResult = KafkaProduceResult | KafkaBrowseResult | KafkaConsumeResult

/** Resolved (handlebars-substituted) config shared by all three lifecycles. */
interface ResolvedKafka {
  brokers: string[]
  brokersJoined: string
  clientId: string
  topic: string
  key?: string
  value: string
  headers: Record<string, string>
  partition?: number
  groupId?: string
  fromOffset: KafkaFromOffset
  specificOffset?: string
  partitions?: number[]
  browsePeekCount?: number
  saslMechanism: KafkaSaslMechanism
  saslUsername?: string
  saslPassword?: string
  tlsEnabled?: boolean
}

/** A live produce / browse / consume in flight, so {@link KafkaExecutionService.cancel}
 * can abort any of the three uniformly. */
interface ActiveKafkaOperation {
  kind: 'produce' | 'browse' | 'consume'
  kill: () => void
}

/** Convert kafkajs' `IHeaders` (values may be Buffer, string, or an array of
 * either) to a plain string record for the response/history model. */
function headersToRecord(headers: IHeaders | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(headers)) {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value === undefined) continue
    out[key] = Buffer.isBuffer(value) ? value.toString('utf8') : value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export class KafkaExecutionService {
  private activeOperations = new Map<string, ActiveKafkaOperation>()

  /** Resolve every user-facing field through `ContextService` before it hits
   * the wire — the broker list (via the shared URL-resolution pipeline, since
   * `url` carries the comma-separated broker list), topic, key, value,
   * headers, groupId, username, password. Returns null when the request
   * isn't registered with the context service. */
  private async resolveKafka(requestId: string, timeoutMs: number): Promise<ResolvedKafka | null> {
    const requestContext = contextService.getRequestContext(requestId)
    const fullData = requestContext?.fullData
    if (!fullData) return null

    const abortController = new AbortController()
    const timer = setTimeout(() => { abortController.abort() }, timeoutMs)
    try {
      const envSecrets = contextService.collectEnvironmentSecrets(requestId)
      const secrets = [...collectRequestSecrets(requestContext.keyValueGroups), ...envSecrets]
      if (secrets.length > 0) {
        await secretHydrationService.hydrate(requestId, secrets, abortController.signal)
        if (envSecrets.length > 0) contextService.refreshEnvironmentContext(requestId)
      }
    } finally {
      clearTimeout(timer)
    }

    const brokersJoined = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? contextService.resolveValue(fullData.url, requestId)
    const brokers = brokersJoined.split(',').map((b) => b.trim()).filter((b) => b.length > 0)

    const headers: Record<string, string> = {}
    const headersGroup = requestContext.keyValueGroups.get('headers')
    if (headersGroup) {
      for (const h of headersGroup) {
        if (h.enabled === false || !h.key) continue
        headers[contextService.resolveValue(h.key, requestId)] = contextService.resolveKeyValueForRequest(h, requestId)
      }
    }

    return {
      brokers,
      brokersJoined,
      clientId: fullData.kafkaClientId ? contextService.resolveValue(fullData.kafkaClientId, requestId) : 'restorm',
      topic: contextService.resolveValue(fullData.kafkaTopic ?? '', requestId),
      ...(fullData.kafkaKey !== undefined ? { key: contextService.resolveValue(fullData.kafkaKey, requestId) } : {}),
      value: fullData.kafkaValue !== undefined ? contextService.resolveValue(fullData.kafkaValue, requestId) : '',
      headers,
      ...(fullData.kafkaPartition !== undefined ? { partition: fullData.kafkaPartition } : {}),
      ...(fullData.kafkaGroupId !== undefined ? { groupId: contextService.resolveValue(fullData.kafkaGroupId, requestId) } : {}),
      fromOffset: fullData.kafkaFromOffset ?? 'latest',
      ...(fullData.kafkaSpecificOffset !== undefined ? { specificOffset: contextService.resolveValue(fullData.kafkaSpecificOffset, requestId) } : {}),
      ...(fullData.kafkaPartitions !== undefined ? { partitions: fullData.kafkaPartitions } : {}),
      ...(fullData.kafkaBrowsePeekCount !== undefined ? { browsePeekCount: fullData.kafkaBrowsePeekCount } : {}),
      saslMechanism: fullData.kafkaSaslMechanism ?? 'none',
      ...(fullData.kafkaSaslUsername !== undefined ? { saslUsername: contextService.resolveValue(fullData.kafkaSaslUsername, requestId) } : {}),
      ...(fullData.kafkaSaslPassword !== undefined ? { saslPassword: contextService.resolveValue(fullData.kafkaSaslPassword, requestId) } : {}),
      ...(fullData.kafkaTlsEnabled !== undefined ? { tlsEnabled: fullData.kafkaTlsEnabled } : {})
    }
  }

  private buildKafkaConfig(resolved: ResolvedKafka): KafkaConfig {
    const sasl: SASLOptions | undefined =
      resolved.saslMechanism !== 'none' && resolved.saslUsername !== undefined
        ? ({ mechanism: resolved.saslMechanism, username: resolved.saslUsername, password: resolved.saslPassword ?? '' } as SASLOptions)
        : undefined
    return {
      brokers: resolved.brokers,
      clientId: resolved.clientId,
      ...(resolved.tlsEnabled ? { ssl: true } : {}),
      ...(sasl ? { sasl } : {}),
      connectionTimeout: DEFAULT_REQUEST_TIMEOUT_MS,
      // kafkajs logs to stdout by default at NOTHING it stays silent; this
      // app has its own `logger` (used explicitly below) for diagnostics.
      logLevel: KafkaLogLevel.NOTHING
    }
  }

  // ==========================================================================
  // Produce — one-shot: connect -> send -> disconnect.
  // ==========================================================================

  async produce(input: KafkaExecutionInput): Promise<KafkaProduceResult> {
    const { requestId, timeout = DEFAULT_REQUEST_TIMEOUT_MS } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    const resolved = await this.resolveKafka(requestId, timeout)
    if (!resolved) {
      return {
        requestId, success: false, kafkaMode: 'produce', requestTopic: '', requestUrl: '',
        error: 'No resolved config found for this request. Make sure the request is registered.',
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    this.broadcastProgress(requestId, 'started')
    const killedRef = { current: false }
    this.activeOperations.set(requestId, { kind: 'produce', kill: () => { killedRef.current = true } })

    try {
      const result = await withFirewallBypass(async () => {
        const kafka = new Kafka(this.buildKafkaConfig(resolved))
        const producer = kafka.producer()
        await producer.connect()
        try {
          if (killedRef.current) throw new Error('Produce cancelled')
          const records = await producer.send({
            topic: resolved.topic,
            messages: [{
              ...(resolved.key !== undefined ? { key: resolved.key } : {}),
              value: resolved.value,
              ...(resolved.partition !== undefined ? { partition: resolved.partition } : {}),
              ...(Object.keys(resolved.headers).length > 0 ? { headers: resolved.headers } : {})
            }]
          })
          return records[0]
        } finally {
          await producer.disconnect()
        }
      })

      const durationMs = Date.now() - startTime
      this.broadcastProgress(requestId, 'completed')
      const out: KafkaProduceResult = {
        requestId, success: true, kafkaMode: 'produce',
        requestTopic: resolved.topic, requestUrl: resolved.brokersJoined,
        partition: result?.partition,
        ...(result?.offset !== undefined ? { offset: result.offset } : {}),
        timings: { startedAt, durationMs }
      }
      void responseHistoryService.storeExecutionResult(requestId, 'kafka', out)
      return out
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.warn('[KafkaExecutionService] produce failed', { requestId, error: String(err) })
      this.broadcastProgress(requestId, killedRef.current ? 'cancelled' : 'error')
      const out: KafkaProduceResult = {
        requestId, success: false, kafkaMode: 'produce',
        requestTopic: resolved.topic, requestUrl: resolved.brokersJoined,
        error: (err as Error).message || 'Kafka produce failed',
        timings: { startedAt, durationMs }
      }
      void responseHistoryService.storeExecutionResult(requestId, 'kafka', out)
      return out
    } finally {
      this.activeOperations.delete(requestId)
    }
  }

  // ==========================================================================
  // Browse — one-shot peek via an EPHEMERAL consumer group: never committed,
  // never joined as a durable group, so it never interferes with a real
  // consume-mode consumer group reading the same topic.
  // ==========================================================================

  async browse(input: KafkaExecutionInput): Promise<KafkaBrowseResult> {
    const { requestId, timeout = DEFAULT_REQUEST_TIMEOUT_MS } = input
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    const resolved = await this.resolveKafka(requestId, timeout)
    if (!resolved) {
      return {
        requestId, success: false, kafkaMode: 'browse', requestTopic: '', requestUrl: '', messages: [],
        error: 'No resolved config found for this request. Make sure the request is registered.',
        timings: { startedAt, durationMs: Date.now() - startTime }
      }
    }

    const peekCount = resolved.browsePeekCount && resolved.browsePeekCount > 0 ? resolved.browsePeekCount : 10
    const partition = resolved.partition ?? 0
    this.broadcastProgress(requestId, 'started')
    let consumerRef: Consumer | undefined
    this.activeOperations.set(requestId, { kind: 'browse', kill: () => { void consumerRef?.disconnect() } })

    try {
      const messages: KafkaMessageFrame[] = []
      await withFirewallBypass(async () => {
        const kafka = new Kafka(this.buildKafkaConfig(resolved))
        // Ephemeral group id — kafkajs' admin client has no raw
        // fetch-messages API, so peeking without joining a durable group
        // means a throwaway group that never commits an offset.
        const consumer = kafka.consumer({ groupId: `restorm-browse-${randomUUID()}` })
        consumerRef = consumer
        await consumer.connect()
        await consumer.subscribe({ topic: resolved.topic, fromBeginning: resolved.fromOffset === 'earliest' })

        let seeked = resolved.fromOffset !== 'specific'
        const runPromise = consumer.run({
          autoCommit: false,
          // Not `async` — nothing here awaits, and kafkajs only requires the
          // handler to RETURN a `Promise<void>`, not declare itself `async`.
          eachMessage: ({ topic, partition: p, message }) => {
            if (p !== partition) return Promise.resolve()
            if (!seeked) {
              seeked = true
              consumer.seek({ topic, partition: p, offset: resolved.specificOffset ?? '0' })
              return Promise.resolve()
            }
            messages.push({
              direction: 'received', topic, partition: p, offset: message.offset,
              ...(message.key ? { key: message.key.toString('utf8') } : {}),
              value: message.value ? message.value.toString('utf8') : '',
              ...(headersToRecord(message.headers) ? { headers: headersToRecord(message.headers) } : {}),
              timestamp: new Date(Number(message.timestamp)).toISOString()
            })
            return Promise.resolve()
          }
        })

        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (messages.length >= peekCount) { clearInterval(timer); resolve() }
          }, 50)
          setTimeout(() => { clearInterval(timer); resolve() }, timeout)
        })
        await consumer.stop()
        await runPromise
        await consumer.disconnect()
      })

      const durationMs = Date.now() - startTime
      this.broadcastProgress(requestId, 'completed')
      const out: KafkaBrowseResult = {
        requestId, success: true, kafkaMode: 'browse',
        requestTopic: resolved.topic, requestUrl: resolved.brokersJoined,
        messages, timings: { startedAt, durationMs }
      }
      void responseHistoryService.storeExecutionResult(requestId, 'kafka', out)
      return out
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.warn('[KafkaExecutionService] browse failed', { requestId, error: String(err) })
      this.broadcastProgress(requestId, 'error')
      const out: KafkaBrowseResult = {
        requestId, success: false, kafkaMode: 'browse',
        requestTopic: resolved.topic, requestUrl: resolved.brokersJoined, messages: [],
        error: (err as Error).message || 'Kafka browse failed',
        timings: { startedAt, durationMs }
      }
      void responseHistoryService.storeExecutionResult(requestId, 'kafka', out)
      return out
    } finally {
      this.activeOperations.delete(requestId)
    }
  }

  // ==========================================================================
  // Consume — streaming: connect -> subscribe -> eachMessage -> stop/
  // disconnect on cancel. Bridged into the scenario engine the same way
  // `connectStreamingMqtt` is (see `main/scenarioEngine/engine.ts`,
  // `transport: 'kafka'`).
  // ==========================================================================

  connectStreamingConsumer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, connected: false, startTime: 0, startedAt: '', url: '', topic: '' }
    const frames: KafkaMessageFrame[] = []
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      if (ctl.startTime > 0) {
        const out: KafkaConsumeResult = {
          requestId, success: ctl.connected && error === undefined, kafkaMode: 'consume',
          requestTopic: ctl.topic, requestUrl: ctl.url, connected: ctl.connected, messages: frames,
          ...(error !== undefined ? { error } : {}),
          timings: { startedAt: ctl.startedAt, durationMs: Date.now() - ctl.startTime }
        }
        void responseHistoryService.storeExecutionResult(requestId, 'kafka', out)
      }
      input.onClose(error)
    }

    void (async () => {
      let resolved: ResolvedKafka | null
      try {
        resolved = await this.resolveKafka(requestId, input.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (!resolved) { fireClose('No resolved config found for this request.'); return }
      if (ctl.closedByCaller) { fireClose(); return }
      ctl.startTime = Date.now()
      ctl.startedAt = new Date().toISOString()
      ctl.url = resolved.brokersJoined
      ctl.topic = resolved.topic

      try {
        const kafka = new Kafka(this.buildKafkaConfig(resolved))
        const groupId = resolved.groupId && resolved.groupId.length > 0 ? resolved.groupId : `restorm-${requestId}`
        const consumer = kafka.consumer({ groupId })
        this.activeOperations.set(requestId, { kind: 'consume', kill: () => { void consumer.disconnect() } })
        this.broadcastProgress(requestId, 'started')

        await withFirewallBypass(async () => {
          await consumer.connect()
          await consumer.subscribe({ topic: resolved.topic, fromBeginning: resolved.fromOffset === 'earliest' })
          ctl.connected = true
          input.onConnect()

          const partitionFilter = new Set(resolved.partitions ?? [])
          // Track which partitions still need a one-time seek when
          // `fromOffset === 'specific'` — the first message observed on a
          // given partition triggers the seek + is dropped (kafkajs' documented
          // idiom for seeking to a starting offset before the real read).
          const seekedPartitions = new Set<number>()
          const needsSeek = resolved.fromOffset === 'specific' && resolved.specificOffset !== undefined

          const specificOffset = resolved.specificOffset
          await consumer.run({
            autoCommit: true,
            // Not `async` — nothing here awaits (mirrors `browse`'s handler).
            eachMessage: ({ topic, partition, message }) => {
              if (partitionFilter.size > 0 && !partitionFilter.has(partition)) return Promise.resolve()
              if (needsSeek && !seekedPartitions.has(partition) && specificOffset !== undefined) {
                seekedPartitions.add(partition)
                consumer.seek({ topic, partition, offset: specificOffset })
                return Promise.resolve()
              }
              const frame: KafkaMessageFrame = {
                direction: 'received', topic, partition, offset: message.offset,
                ...(message.key ? { key: message.key.toString('utf8') } : {}),
                value: message.value ? message.value.toString('utf8') : '',
                ...(headersToRecord(message.headers) ? { headers: headersToRecord(message.headers) } : {}),
                timestamp: new Date(Number(message.timestamp)).toISOString()
              }
              frames.push(frame)
              this.broadcastMessage(requestId, frame)
              let parsed: unknown
              try { parsed = JSON.parse(frame.value) } catch { parsed = frame.value }
              input.onMessage(undefined, parsed)
              return Promise.resolve()
            }
          })
        })

        // `run()` resolved — the consumer was stopped/disconnected (a Stop, a
        // kafkaClose, or `close()` below), not a crash.
        this.activeOperations.delete(requestId)
        this.broadcastProgress(requestId, 'completed')
        fireClose()
      } catch (err) {
        this.activeOperations.delete(requestId)
        this.broadcastProgress(requestId, 'error')
        fireClose((err as Error).message || 'Kafka consumer failed')
      }
    })()

    return {
      // No publish action on the consume side (produce is its own one-shot
      // node) — the handle still exposes a no-op `send` so it matches the
      // shape every other streaming connect returns.
      send: () => false,
      close: () => { ctl.closedByCaller = true; this.cancel(requestId) },
      isOpen: () => this.activeOperations.has(requestId)
    }
  }

  // ==========================================================================
  // Shared active-operation registry.
  // ==========================================================================

  cancel(requestId: string): boolean {
    const active = this.activeOperations.get(requestId)
    if (!active) return false
    logger.info('[KafkaExecutionService] Cancelling operation', { requestId, kind: active.kind })
    active.kill()
    this.activeOperations.delete(requestId)
    return true
  }

  isActive(requestId: string): boolean {
    return this.activeOperations.has(requestId)
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('kafka:request-progress', { requestId, status })
    }
  }

  private broadcastMessage(requestId: string, message: KafkaMessageFrame): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('kafka:message', { requestId, message })
    }
  }
}

export const kafkaExecutionService = new KafkaExecutionService()

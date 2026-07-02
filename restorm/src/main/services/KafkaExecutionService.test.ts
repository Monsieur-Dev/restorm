import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted; they must not reference outer vars.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

const { firewallBypassSpy } = vi.hoisted(() => ({
  firewallBypassSpy: vi.fn(<T>(fn: () => T): T => fn())
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypass: firewallBypassSpy
}))

vi.mock('./ContextService', () => {
  const resolveValueMock = vi.fn((v: string) => v)
  return {
    contextService: {
      getRequestContext: vi.fn(),
      getResolvedUrl: vi.fn(() => undefined),
      resolveValue: resolveValueMock,
      resolveKeyValueForRequest: vi.fn((kv: { value: unknown }) => String(kv.value)),
      collectEnvironmentSecrets: vi.fn(() => []),
      refreshEnvironmentContext: vi.fn(() => undefined)
    }
  }
})

// A standalone hoisted `vi.fn()` (not a class-method property access) so
// assertions never trip `@typescript-eslint/unbound-method` against the real
// `ResponseHistoryService`'s `this`-bound method signature.
const { storeExecutionResultMock } = vi.hoisted(() => ({ storeExecutionResultMock: vi.fn() }))

vi.mock('./ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: storeExecutionResultMock }
}))

vi.mock('./secrets/SecretHydrationService', () => ({
  secretHydrationService: { hydrate: vi.fn().mockResolvedValue(undefined) }
}))

// ---------------------------------------------------------------------------
// kafkajs mock — a controllable fake broker: `Kafka.mock.calls` captures the
// config each service call built (asserts SASL/TLS wiring); the returned
// producer/consumer/admin are per-instance `vi.fn()`s a test configures.
// ---------------------------------------------------------------------------

interface MockProducer {
  connect: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}
interface MockConsumer {
  connect: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  seek: ReturnType<typeof vi.fn>
  /** The group id the service constructed this consumer with. */
  groupId?: string
  /** Captured from the last `run({ eachMessage })` call. */
  eachMessage?: (payload: {
    topic: string
    partition: number
    message: { offset: string; key?: Buffer; value?: Buffer; headers?: Record<string, unknown>; timestamp: string }
  }) => Promise<void>
}

function createMockProducer(): MockProducer {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue([{ partition: 0, offset: '42' }]),
    disconnect: vi.fn().mockResolvedValue(undefined)
  }
}

function createMockConsumer(): MockConsumer {
  let resolveRun: (() => void) | undefined
  const consumer: MockConsumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn((opts: { eachMessage: MockConsumer['eachMessage'] }) => {
      consumer.eachMessage = opts.eachMessage
      // Real kafkajs `run()` resolves once the consumer stops — either an
      // explicit `stop()` (used by `browse`) or `disconnect()` (used by
      // `connectStreamingConsumer`'s cancel path) unblocks it.
      return new Promise<void>((resolve) => { resolveRun = resolve })
    }),
    stop: vi.fn(() => { resolveRun?.(); return Promise.resolve() }),
    disconnect: vi.fn(() => { resolveRun?.(); return Promise.resolve() }),
    seek: vi.fn()
  }
  return consumer
}

const kafkaConstructorSpy = vi.fn()
let nextProducer: MockProducer
let nextConsumer: MockConsumer

vi.mock('kafkajs', () => ({
  // A plain `function` (not an arrow) — the service calls `new Kafka(config)`,
  // and only a real function/class is constructible.
  Kafka: vi.fn().mockImplementation(function (config: unknown) {
    kafkaConstructorSpy(config)
    return {
      producer: () => nextProducer,
      consumer: (opts: { groupId: string }) => { nextConsumer.groupId = opts.groupId; return nextConsumer }
    }
  }),
  logLevel: { NOTHING: 0 }
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { kafkaExecutionService } from './KafkaExecutionService'
import { contextService } from './ContextService'
import type { FullRequestData } from './ContextServiceTypes'

const mockedContextService = vi.mocked(contextService)

/** Register a fake `RequestContext` for `requestId` — the minimal shape
 * `KafkaExecutionService.resolveKafka` reads. */
function stubRequestContext(overrides: Partial<FullRequestData> = {}): void {
  mockedContextService.getRequestContext.mockReturnValue({
    environmentId: null,
    availableEnvironmentIds: [],
    keyValueGroups: new Map(),
    fullData: {
      id: 'req-1',
      requestType: 'kafka',
      url: 'localhost:9092',
      headers: [],
      kafkaTopic: 'restorm-test',
      kafkaValue: 'hello',
      kafkaFromOffset: 'latest',
      kafkaSaslMechanism: 'none',
      ...overrides
    } as unknown as FullRequestData
  })
}

describe('KafkaExecutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextProducer = createMockProducer()
    nextConsumer = createMockConsumer()
    mockedContextService.getRequestContext.mockReturnValue(undefined)
  })

  describe('produce', () => {
    it('returns an error result when the request is not registered', async () => {
      const result = await kafkaExecutionService.produce({ requestId: 'unregistered' })
      expect(result.success).toBe(false)
      expect(result.kafkaMode).toBe('produce')
      expect(result.error).toMatch(/No resolved config/)
    })

    it('connects, sends, disconnects, and returns the RecordMetadata on success', async () => {
      stubRequestContext()
      const result = await kafkaExecutionService.produce({ requestId: 'req-1' })

      expect(nextProducer.connect).toHaveBeenCalledTimes(1)
      expect(nextProducer.send).toHaveBeenCalledWith(expect.objectContaining({
        topic: 'restorm-test',
        messages: [expect.objectContaining({ value: 'hello' })]
      }))
      expect(nextProducer.disconnect).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
      expect(result.partition).toBe(0)
      expect(result.offset).toBe('42')
      expect(storeExecutionResultMock).toHaveBeenCalledWith('req-1', 'kafka', expect.objectContaining({ success: true }))
    })

    it('disconnects and surfaces the error when send() rejects', async () => {
      stubRequestContext()
      nextProducer.send.mockRejectedValue(new Error('broker unreachable'))
      const result = await kafkaExecutionService.produce({ requestId: 'req-1' })

      expect(nextProducer.disconnect).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(false)
      expect(result.error).toBe('broker unreachable')
    })

    it('wires SASL PLAIN + TLS into the kafkajs client config', async () => {
      stubRequestContext({
        kafkaSaslMechanism: 'plain',
        kafkaSaslUsername: 'alice',
        kafkaSaslPassword: 'secret',
        kafkaTlsEnabled: true
      } as Partial<FullRequestData>)
      await kafkaExecutionService.produce({ requestId: 'req-1' })

      expect(kafkaConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
        brokers: ['localhost:9092'],
        ssl: true,
        sasl: { mechanism: 'plain', username: 'alice', password: 'secret' }
      }))
    })

    it('omits `sasl` entirely when the mechanism is `none`', async () => {
      stubRequestContext()
      await kafkaExecutionService.produce({ requestId: 'req-1' })
      const config = kafkaConstructorSpy.mock.calls[0]?.[0] as Record<string, unknown>
      expect(config['sasl']).toBeUndefined()
      expect(config['ssl']).toBeUndefined()
    })
  })

  describe('browse', () => {
    it('peeks the requested number of messages via an ephemeral consumer group, never committing', async () => {
      stubRequestContext({ kafkaBrowsePeekCount: 2, kafkaPartition: 0 } as Partial<FullRequestData>)

      const browsePromise = kafkaExecutionService.browse({ requestId: 'req-1', timeout: 2000 })
      await vi.waitFor(() => { expect(nextConsumer.eachMessage).toBeDefined() })

      await nextConsumer.eachMessage?.({
        topic: 'restorm-test', partition: 0,
        message: { offset: '1', value: Buffer.from('msg-1'), timestamp: '1700000000000' }
      })
      await nextConsumer.eachMessage?.({
        topic: 'restorm-test', partition: 0,
        message: { offset: '2', value: Buffer.from('msg-2'), timestamp: '1700000000001' }
      })

      const result = await browsePromise
      expect(result.success).toBe(true)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]).toMatchObject({ direction: 'received', partition: 0, offset: '1', value: 'msg-1' })
      expect(nextConsumer.subscribe).toHaveBeenCalledWith(expect.objectContaining({ topic: 'restorm-test' }))
      // Ephemeral group id: never reused, never committed.
      expect((nextConsumer as unknown as { groupId: string }).groupId).toMatch(/^restorm-browse-/)
      expect(nextConsumer.disconnect).toHaveBeenCalledTimes(1)
    })

    it('ignores messages from partitions other than the requested one', async () => {
      stubRequestContext({ kafkaBrowsePeekCount: 1, kafkaPartition: 0 } as Partial<FullRequestData>)
      const browsePromise = kafkaExecutionService.browse({ requestId: 'req-1', timeout: 500 })
      await vi.waitFor(() => { expect(nextConsumer.eachMessage).toBeDefined() })

      await nextConsumer.eachMessage?.({
        topic: 'restorm-test', partition: 1,
        message: { offset: '9', value: Buffer.from('wrong-partition'), timestamp: '1700000000000' }
      })
      const result = await browsePromise
      // The off-partition message never counted toward peekCount, so the
      // browse times out with zero collected messages.
      expect(result.messages).toHaveLength(0)
    })
  })

  describe('connectStreamingConsumer', () => {
    it('connects, subscribes, and re-emits each received message as parsed JSON', async () => {
      stubRequestContext({ kafkaGroupId: 'my-group', kafkaFromOffset: 'earliest' } as Partial<FullRequestData>)
      const onConnect = vi.fn()
      const onMessage = vi.fn()
      const onClose = vi.fn()

      const handle = kafkaExecutionService.connectStreamingConsumer({ requestId: 'req-1', onConnect, onMessage, onClose })
      await vi.waitFor(() => { expect(onConnect).toHaveBeenCalledTimes(1) })
      expect(nextConsumer.subscribe).toHaveBeenCalledWith(expect.objectContaining({ topic: 'restorm-test', fromBeginning: true }))

      await nextConsumer.eachMessage?.({
        topic: 'restorm-test', partition: 0,
        message: { offset: '5', value: Buffer.from(JSON.stringify({ hello: 'world' })), timestamp: '1700000000000' }
      })
      expect(onMessage).toHaveBeenCalledWith(undefined, { hello: 'world' })
      expect(kafkaExecutionService.isActive('req-1')).toBe(true)

      handle.close()
      await vi.waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
      expect(nextConsumer.disconnect).toHaveBeenCalled()
      expect(kafkaExecutionService.isActive('req-1')).toBe(false)
    })

    it('seeks to the specific offset on the first message per partition, then drops it', async () => {
      stubRequestContext({ kafkaFromOffset: 'specific', kafkaSpecificOffset: '100' } as Partial<FullRequestData>)
      const onMessage = vi.fn()
      kafkaExecutionService.connectStreamingConsumer({ requestId: 'req-1', onConnect: vi.fn(), onMessage, onClose: vi.fn() })
      await vi.waitFor(() => { expect(nextConsumer.eachMessage).toBeDefined() })

      await nextConsumer.eachMessage?.({
        topic: 'restorm-test', partition: 0,
        message: { offset: '50', value: Buffer.from('skip-me'), timestamp: '1700000000000' }
      })
      expect(nextConsumer.seek).toHaveBeenCalledWith({ topic: 'restorm-test', partition: 0, offset: '100' })
      expect(onMessage).not.toHaveBeenCalled()

      await nextConsumer.eachMessage?.({
        topic: 'restorm-test', partition: 0,
        message: { offset: '100', value: Buffer.from('real-message'), timestamp: '1700000000001' }
      })
      expect(onMessage).toHaveBeenCalledWith(undefined, 'real-message')
    })
  })

  describe('cancel / isActive', () => {
    it('returns false for a request with no active operation', () => {
      expect(kafkaExecutionService.cancel('nope')).toBe(false)
      expect(kafkaExecutionService.isActive('nope')).toBe(false)
    })
  })
})

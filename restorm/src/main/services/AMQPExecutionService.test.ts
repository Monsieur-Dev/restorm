import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks for the Electron-facing + context surfaces the service touches.
// Mirrors GraphQLSubscriptionService.test.ts's pattern: capture every
// `webContents.send` so the broadcast channels are assertable, and stub the
// resolution chain with an in-memory fixture the tests mutate per-case.
// ---------------------------------------------------------------------------

const sent: { channel: string; payload: unknown }[] = []
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } } }
    ]
  }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  // The real helper pre-authorises the firewall interceptor around a connect
  // call; the unit under test only cares that the wrapped function still runs.
  withFirewallBypass: async <T>(fn: () => Promise<T>): Promise<T> => fn()
}))

const ctx = {
  resolvedUrl: 'amqp://localhost:5672',
  fullData: {} as Record<string, unknown>
}
// `vi.mock` factories are hoisted above every other top-level statement, so a
// mock referenced by VALUE (not wrapped in a lazily-called closure) needs
// `vi.hoisted` to exist before the factory runs.
const { storeExecutionResult } = vi.hoisted(() => ({ storeExecutionResult: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./ContextService', () => ({
  contextService: {
    getResolvedUrl: (_id: string) => ({ resolvedUrl: ctx.resolvedUrl }),
    getRequestContext: (_id: string) => ({ fullData: ctx.fullData }),
    collectEnvironmentSecrets: () => [],
    refreshEnvironmentContext: () => undefined,
    resolveValue: (v: string) => v
  }
}))
vi.mock('./ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult }
}))
vi.mock('./secrets/SecretHydrationService', () => ({
  secretHydrationService: { hydrate: vi.fn().mockResolvedValue(undefined) }
}))

// Fake amqplib: a connect() call yields a fake ChannelModel whose channel
// exposes just the surface AMQPExecutionService drives (publish / consume /
// get / nack / close / prefetch / `on`). Event handlers are captured so a
// test can fire them (`triggerChannelError`, `triggerModelEvent`) to drive
// the reconnect / close paths without a real broker.
interface FakeChannel {
  publish: ReturnType<typeof vi.fn>
  consume: ReturnType<typeof vi.fn>
  assertQueue: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  nack: ReturnType<typeof vi.fn>
  ack: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  prefetch: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  errorHandlers: ((err: Error) => void)[]
}
interface FakeModel {
  createChannel: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  handlers: Record<string, ((...args: unknown[]) => void)[]>
}

function makeFakeChannel(): FakeChannel {
  const errorHandlers: ((err: Error) => void)[] = []
  return {
    publish: vi.fn().mockReturnValue(true),
    consume: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(false),
    nack: vi.fn(),
    ack: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (err: Error) => void) => { if (event === 'error') errorHandlers.push(cb) }),
    errorHandlers
  }
}

function makeFakeModel(channel: FakeChannel): FakeModel {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  const self: FakeModel = {
    createChannel: vi.fn().mockResolvedValue(channel),
    close: vi.fn().mockImplementation(() => { fireModelEvent(self, 'close'); return Promise.resolve() }),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] ??= []
      handlers[event].push(cb)
    }),
    handlers
  }
  return self
}

function fireModelEvent(model: FakeModel, event: string, ...args: unknown[]): void {
  for (const cb of model.handlers[event] ?? []) cb(...args)
}

let nextChannel: FakeChannel
let nextModel: FakeModel
const connectMock = vi.fn((_url: string, _options?: { timeout?: number }): Promise<FakeModel> => Promise.resolve(nextModel))
vi.mock('amqplib', () => ({
  connect: (...args: unknown[]) => connectMock(...args)
}))

import {
  amqpExecutionService,
  describeAmqpConnectError,
  applyAmqpConnectionOverrides
} from './AMQPExecutionService'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  sent.length = 0
  storeExecutionResult.mockClear()
  connectMock.mockClear()
  ctx.resolvedUrl = 'amqp://localhost:5672'
  ctx.fullData = {}
  nextChannel = makeFakeChannel()
  nextModel = makeFakeModel(nextChannel)
})

// ===========================================================================
// Pure helpers
// ===========================================================================

describe('describeAmqpConnectError', () => {
  it('maps known socket error codes to actionable messages', () => {
    expect(describeAmqpConnectError({ code: 'ECONNREFUSED' }, 'amqp://x')).toMatch(/Connection refused/)
    expect(describeAmqpConnectError({ code: 'ENOTFOUND' }, 'amqp://x')).toMatch(/Host not found/)
    expect(describeAmqpConnectError({ code: 'ETIMEDOUT' }, 'amqp://x')).toMatch(/timed out/)
    expect(describeAmqpConnectError({ code: 'ECONNRESET' }, 'amqp://x')).toMatch(/reset/)
    expect(describeAmqpConnectError({ code: 'ENETUNREACH' }, 'amqp://x')).toMatch(/unreachable/)
  })

  it('falls back to the error message, then a generic string', () => {
    expect(describeAmqpConnectError(new Error('boom'), 'amqp://x')).toBe('AMQP connection failed at amqp://x: boom')
    expect(describeAmqpConnectError(undefined, 'amqp://x')).toBe('AMQP connection failed at amqp://x.')
    expect(describeAmqpConnectError(undefined, '')).toBe('AMQP connection failed.')
  })
})

describe('applyAmqpConnectionOverrides', () => {
  it('overrides vhost / username / password on a parseable URL', () => {
    const out = applyAmqpConnectionOverrides('amqp://localhost:5672', 'my/vhost', 'alice', 's3cret')
    const u = new URL(out)
    expect(u.pathname).toBe('/' + encodeURIComponent('my/vhost'))
    expect(u.username).toBe('alice')
    expect(u.password).toBe('s3cret')
  })

  it('leaves the URL untouched when a field is undefined', () => {
    const out = applyAmqpConnectionOverrides('amqp://localhost:5672/', undefined, undefined, undefined)
    expect(out).toBe('amqp://localhost:5672/')
  })

  it('returns the URL unmodified when it does not parse (mid-typing a template)', () => {
    expect(applyAmqpConnectionOverrides('{{brokerUrl}}', '/', 'a', 'b')).toBe('{{brokerUrl}}')
  })
})

// ===========================================================================
// execute() — publish / browse (one-shot)
// ===========================================================================

describe('AMQPExecutionService.execute — publish', () => {
  it('connects, publishes, closes, and persists a successful result', async () => {
    ctx.fullData = { mode: 'publish', exchange: 'orders', routingKey: 'orders.created', payload: '{"id":1}' }
    const result = await amqpExecutionService.execute({ requestId: 'r1' })

    expect(connectMock.mock.calls[0]?.[0]).toBe('amqp://localhost:5672')
    expect(typeof connectMock.mock.calls[0]?.[1]?.timeout).toBe('number')
    expect(nextChannel.publish).toHaveBeenCalledWith('orders', 'orders.created', Buffer.from('{"id":1}'))
    expect(nextChannel.close).toHaveBeenCalled()
    expect(nextModel.close).toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.mode).toBe('publish')
    expect(result.messages).toEqual([
      expect.objectContaining({ direction: 'sent', data: '{"id":1}', exchange: 'orders', routingKey: 'orders.created' })
    ])
    expect(storeExecutionResult).toHaveBeenCalledWith('r1', 'amqp', expect.objectContaining({ success: true }))
  })

  it('reports back-pressure when the channel write buffer is full', async () => {
    ctx.fullData = { mode: 'publish', exchange: '', routingKey: 'k', payload: 'x' }
    nextChannel.publish.mockReturnValue(false)
    const result = await amqpExecutionService.execute({ requestId: 'r2' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/back-pressure/)
  })

  it('settles with a descriptive error when the broker connection fails', async () => {
    ctx.fullData = { mode: 'publish', payload: 'x' }
    connectMock.mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
    const result = await amqpExecutionService.execute({ requestId: 'r3' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Connection refused/)
  })
})

describe('AMQPExecutionService.execute — browse', () => {
  it('peeks up to browsePeekCount messages without acking, then nacks the batch back', async () => {
    ctx.fullData = { mode: 'browse', queue: 'q1', browsePeekCount: 2 }
    const msgs = [
      { content: Buffer.from('m1'), fields: { exchange: 'e', routingKey: 'rk1', deliveryTag: 1 } },
      { content: Buffer.from('m2'), fields: { exchange: 'e', routingKey: 'rk2', deliveryTag: 2 } }
    ]
    nextChannel.get.mockResolvedValueOnce(msgs[0]).mockResolvedValueOnce(msgs[1])

    const result = await amqpExecutionService.execute({ requestId: 'r4' })

    expect(nextChannel.get).toHaveBeenCalledTimes(2)
    expect(nextChannel.nack).toHaveBeenCalledWith(msgs[1], true, true)
    expect(result.success).toBe(true)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toMatchObject({ direction: 'received', data: 'm1', peek: true, deliveryTag: 1 })
  })

  it('stops early when the queue drains before browsePeekCount', async () => {
    ctx.fullData = { mode: 'browse', queue: 'q1', browsePeekCount: 5 }
    nextChannel.get
      .mockResolvedValueOnce({ content: Buffer.from('only'), fields: { exchange: '', routingKey: 'rk', deliveryTag: 1 } })
      .mockResolvedValueOnce(false)
    const result = await amqpExecutionService.execute({ requestId: 'r5' })
    expect(result.messages).toHaveLength(1)
    expect(nextChannel.nack).toHaveBeenCalledTimes(1)
  })

  it('errors when no queue is configured', async () => {
    ctx.fullData = { mode: 'browse' }
    const result = await amqpExecutionService.execute({ requestId: 'r6' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/requires a queue name/)
  })
})

describe('AMQPExecutionService.execute — subscribe', () => {
  it('rejects Send on a subscribe-mode request (use Connect instead)', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q1' }
    const result = await amqpExecutionService.execute({ requestId: 'r7' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/use Connect, not Send/)
    expect(connectMock).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// connectStreaming() — subscribe (long-lived)
// ===========================================================================

describe('AMQPExecutionService.connectStreaming', () => {
  it('connects, registers a consumer, and re-emits a delivered message', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'orders.q', autoAck: true }
    let connected = false
    const events: { routingKey: string | undefined; payload: unknown }[] = []
    const handle = amqpExecutionService.connectStreaming({
      requestId: 'r8',
      onConnect: () => { connected = true },
      onMessage: (routingKey, payload) => { events.push({ routingKey, payload }) },
      onClose: () => undefined
    })
    await flush()

    expect(connected).toBe(true)
    expect(handle.isOpen()).toBe(true)
    expect(nextChannel.consume).toHaveBeenCalledWith('orders.q', expect.any(Function), { noAck: true })
    expect(sent.some((s) => s.channel === 'amqp:connection-progress' && (s.payload as { status: string }).status === 'started')).toBe(true)

    // Simulate a delivered message via the captured consume callback.
    const deliver = nextChannel.consume.mock.calls[0]?.[1] as (msg: unknown) => void
    deliver({ content: Buffer.from('{"n":1}'), fields: { exchange: 'e', routingKey: 'orders.created', deliveryTag: 7 } })

    expect(events).toEqual([{ routingKey: 'orders.created', payload: { n: 1 } }])
    expect(sent.some((s) => s.channel === 'amqp:message')).toBe(true)
    // autoAck true → `noAck: true` was passed to consume, so the service
    // itself must NOT separately ack (that would double-ack).
    expect(nextChannel.ack).not.toHaveBeenCalled()
  })

  it('acks manually when autoAck is false', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q', autoAck: false }
    amqpExecutionService.connectStreaming({ requestId: 'r9', onConnect: () => undefined, onMessage: () => undefined, onClose: () => undefined })
    await flush()
    expect(nextChannel.consume).toHaveBeenCalledWith('q', expect.any(Function), { noAck: false })
    const deliver = nextChannel.consume.mock.calls[0]?.[1] as (msg: unknown) => void
    const msg = { content: Buffer.from('x'), fields: { exchange: '', routingKey: 'k', deliveryTag: 1 } }
    deliver(msg)
    expect(nextChannel.ack).toHaveBeenCalledWith(msg)
  })

  it('errors immediately when the request has no queue configured', async () => {
    ctx.fullData = { mode: 'subscribe' }
    let closeError: string | undefined
    amqpExecutionService.connectStreaming({ requestId: 'r10', onConnect: () => undefined, onMessage: () => undefined, onClose: (e) => { closeError = e } })
    await flush()
    expect(closeError).toMatch(/requires a queue name/)
    expect(amqpExecutionService.isActive('r10')).toBe(false)
  })

  it('recovers from a channel-level protocol error by recreating the channel', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q' }
    amqpExecutionService.connectStreaming({ requestId: 'r11', onConnect: () => undefined, onMessage: () => undefined, onClose: () => undefined })
    await flush()
    expect(nextModel.createChannel).toHaveBeenCalledTimes(1)

    // A channel protocol error (e.g. consuming a non-existent queue) closes
    // only the channel — the service recreates it and resumes consuming,
    // the connection itself stays registered as active.
    nextChannel.errorHandlers[0]?.(new Error('NOT_FOUND - no queue'))
    await flush()
    expect(nextModel.createChannel).toHaveBeenCalledTimes(2)
    expect(amqpExecutionService.isActive('r11')).toBe(true)
  })

  it('gives up after AMQP_MAX_RECONNECT_ATTEMPTS channel errors and settles with an error', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q' }
    let closeError: string | undefined
    amqpExecutionService.connectStreaming({ requestId: 'r12', onConnect: () => undefined, onMessage: () => undefined, onClose: (e) => { closeError = e } })
    await flush()

    // Trip the channel error handler repeatedly — each firing recreates the
    // channel (registering a fresh error handler at the end of the array).
    for (let i = 0; i < 12; i++) {
      const handler = nextChannel.errorHandlers[nextChannel.errorHandlers.length - 1]
      handler?.(new Error(`fail ${i}`))
      await flush()
    }
    expect(closeError).toMatch(/gave up after/)
    expect(amqpExecutionService.isActive('r12')).toBe(false)
  })

  it('settles on a connection-level close (terminal, no reconnect)', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q' }
    let closeError: string | undefined = 'unset'
    amqpExecutionService.connectStreaming({ requestId: 'r13', onConnect: () => undefined, onMessage: () => undefined, onClose: (e) => { closeError = e } })
    await flush()
    expect(amqpExecutionService.isActive('r13')).toBe(true)

    fireModelEvent(nextModel, 'close')
    expect(closeError).toBeUndefined()
    expect(amqpExecutionService.isActive('r13')).toBe(false)
    expect(sent.some((s) => s.channel === 'amqp:connection-progress' && (s.payload as { status: string }).status === 'completed')).toBe(true)
  })

  it('close() disconnects the connection and isOpen() reflects it', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q' }
    const handle = amqpExecutionService.connectStreaming({ requestId: 'r14', onConnect: () => undefined, onMessage: () => undefined, onClose: () => undefined })
    await flush()
    expect(handle.isOpen()).toBe(true)

    handle.close()
    await flush()
    expect(nextModel.close).toHaveBeenCalled()
    expect(handle.isOpen()).toBe(false)
  })

  it('send() publishes on the connection\'s own exchange/routingKey and returns false once closed', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q', exchange: 'ex', routingKey: 'rk' }
    const handle = amqpExecutionService.connectStreaming({ requestId: 'r15', onConnect: () => undefined, onMessage: () => undefined, onClose: () => undefined })
    await flush()

    expect(handle.send('payload-1')).toBe(true)
    expect(nextChannel.publish).toHaveBeenCalledWith('ex', 'rk', Buffer.from('payload-1'))

    handle.close()
    await flush()
    expect(handle.send('payload-2')).toBe(false)
  })
})

describe('AMQPExecutionService.closeAll', () => {
  it('awaits every active connection\'s close', async () => {
    ctx.fullData = { mode: 'subscribe', queue: 'q' }
    amqpExecutionService.connectStreaming({ requestId: 'r16', onConnect: () => undefined, onMessage: () => undefined, onClose: () => undefined })
    await flush()
    expect(amqpExecutionService.isActive('r16')).toBe(true)

    await amqpExecutionService.closeAll()
    expect(nextModel.close).toHaveBeenCalled()
    expect(amqpExecutionService.isActive('r16')).toBe(false)
  })

  it('is a no-op with nothing active', async () => {
    await expect(amqpExecutionService.closeAll()).resolves.toBeUndefined()
  })
})

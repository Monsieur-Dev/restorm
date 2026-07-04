// @vitest-environment node
/**
 * RedisExecutionService — subscribe (streaming) + command (unary) execution.
 * Uses a fake `ioredis` client (an EventEmitter mirroring the events/methods
 * `RedisExecutionService` actually touches) so both modes are exercised
 * deterministically, without a real Redis server. Mirrors the fake-client
 * pattern in `tests/unit/mqttStreamingConnectTimer.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted; they must not reference outer vars
// other than through vi.hoisted().
// ---------------------------------------------------------------------------

const progress = vi.hoisted(() => [] as { requestId: string; status: string }[])
const messages = vi.hoisted(() => [] as { requestId: string; message: { channel?: string; data: string } }[])
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      webContents: {
        send: (channel: string, payload: { requestId: string; status?: string; message?: { channel?: string; data: string } }) => {
          if (channel === 'redis:connection-progress' && payload.status) progress.push({ requestId: payload.requestId, status: payload.status })
          if (channel === 'redis:message' && payload.message) messages.push({ requestId: payload.requestId, message: payload.message })
        }
      }
    }]
  }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypassSync: <T>(fn: () => T): T => fn()
}))

const storeExecutionResultMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: storeExecutionResultMock }
}))
vi.mock('./secrets/SecretHydrationService', () => ({
  secretHydrationService: { hydrate: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('./secrets/collectRequestSecrets', () => ({
  collectRequestSecrets: () => []
}))

/** The per-test request's `fullData` — mutate this in each test instead of
 * re-mocking the module. */
const fullData = vi.hoisted(() => ({
  current: {} as Record<string, unknown>
}))
vi.mock('./ContextService', () => ({
  contextService: {
    getResolvedUrl: vi.fn(() => ({ resolvedUrl: 'redis://localhost:6379' })),
    getRequestContext: vi.fn(() => ({ fullData: fullData.current, keyValueGroups: new Map() })),
    collectEnvironmentSecrets: () => [],
    refreshEnvironmentContext: vi.fn(),
    resolveValue: (v: string) => v
  }
}))

/** A fake ioredis client: an EventEmitter with the subset of the real API
 * `RedisExecutionService` touches. Test-controlled via the mutable fields. */
class FakeRedis extends EventEmitter {
  status = 'connecting'
  subscribeImpl: (...channels: string[]) => Promise<unknown> = () => Promise.resolve(undefined)
  callImpl: (command: string, ...args: string[]) => Promise<unknown> = () => Promise.resolve(null)
  connectImpl: () => Promise<void> = () => { this.status = 'ready'; return Promise.resolve() }

  subscribe(...channels: string[]): Promise<unknown> { return this.subscribeImpl(...channels) }
  call(command: string, ...args: string[]): Promise<unknown> { return this.callImpl(command, ...args) }
  connect(): Promise<void> { return this.connectImpl() }
  disconnect(): void {
    this.status = 'end'
    queueMicrotask(() => this.emit('end'))
  }

  // Mirror ioredis's own `.status` transitions on the two events this service
  // actually reads it after ('ready' → 'ready', 'end' → 'end') — `isActive()`
  // gates on `client.status === 'ready'`.
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'ready') this.status = 'ready'
    if (event === 'end') this.status = 'end'
    return super.emit(event, ...args)
  }
}

const fakeClient = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('ioredis', () => {
  // A genuine `function` (not an arrow, not a `vi.fn` wrapper) so `new
  // Redis(...)` really invokes it as a constructor — returning an object
  // from a constructor call makes `new` yield that object instead of `this`.
  function RedisCtor(this: unknown, ..._args: unknown[]): unknown {
    return fakeClient.current
  }
  return { default: RedisCtor }
})

import { redisExecutionService } from './RedisExecutionService'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const waitFor = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await sleep(5)
  }
}

describe('RedisExecutionService', () => {
  beforeEach(() => {
    progress.length = 0
    messages.length = 0
    storeExecutionResultMock.mockClear()
    fullData.current = {}
  })
  afterEach(() => { vi.clearAllMocks() })

  describe('subscribe mode', () => {
    it('connects, subscribes, streams messages, and reports connected:true on disconnect', async () => {
      fullData.current = { redisMode: 'subscribe', channels: ['news', 'alerts'] }
      const client = new FakeRedis()
      fakeClient.current = client

      const resultPromise = redisExecutionService.subscribe({ requestId: 'sub-1' })

      // The client is constructed asynchronously (a couple of microtask hops
      // inside the service) — wait for its 'ready' listener to actually be
      // attached before emitting, or the event fires into the void.
      await waitFor(() => client.listenerCount('ready') > 0)

      // Simulate the broker handshake: 'ready' then a successful SUBSCRIBE.
      client.emit('ready')
      await waitFor(() => progress.some((p) => p.requestId === 'sub-1' && p.status === 'started'))

      // A message arrives while the subscription is open.
      client.emit('message', 'news', 'hello world')
      await waitFor(() => messages.some((m) => m.requestId === 'sub-1'))
      expect(messages[0]?.message).toMatchObject({ channel: 'news', data: 'hello world' })

      // A connect-time history entry is persisted (so a poller doesn't block
      // for the whole session).
      await waitFor(() => storeExecutionResultMock.mock.calls.some((c) => c[0] === 'sub-1' && (c[2] as { connected?: boolean }).connected === true))

      expect(redisExecutionService.isActive('sub-1')).toBe(true)

      // User disconnects — the client's 'end' event resolves the promise.
      redisExecutionService.disconnect('sub-1')
      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.mode).toBe('subscribe')
      expect(result.connected).toBe(true)
      expect(result.channels).toEqual(['news', 'alerts'])
      expect(result.messages).toHaveLength(1)
      expect(result.messages?.[0]).toMatchObject({ direction: 'received', channel: 'news', data: 'hello world' })
      expect(typeof result.messages?.[0]?.timestamp).toBe('string')
      expect(redisExecutionService.isActive('sub-1')).toBe(false)
    })

    it('fails fast when there are no channels to subscribe to', async () => {
      fullData.current = { redisMode: 'subscribe', channels: [] }
      const client = new FakeRedis()
      fakeClient.current = client

      const result = await redisExecutionService.subscribe({ requestId: 'sub-empty' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No channels/)
    })

    it('times out when the server never becomes ready', async () => {
      fullData.current = { redisMode: 'subscribe', channels: ['news'] }
      const client = new FakeRedis()
      fakeClient.current = client

      const result = await redisExecutionService.subscribe({ requestId: 'sub-timeout', timeout: 30 })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timed out/)
    })

    it('cancel()/disconnect() aborts an active subscription cleanly', async () => {
      fullData.current = { redisMode: 'subscribe', channels: ['news'] }
      const client = new FakeRedis()
      fakeClient.current = client

      const resultPromise = redisExecutionService.subscribe({ requestId: 'sub-cancel' })
      await waitFor(() => client.listenerCount('ready') > 0)
      client.emit('ready')
      await waitFor(() => redisExecutionService.isActive('sub-cancel'))

      expect(redisExecutionService.cancel('sub-cancel')).toBe(true)
      const result = await resultPromise
      expect(result.connected).toBe(true)
      expect(redisExecutionService.isActive('sub-cancel')).toBe(false)
      // Disconnecting an already-closed connection is a no-op, not a throw.
      expect(redisExecutionService.disconnect('sub-cancel')).toBe(false)
    })
  })

  describe('command mode', () => {
    it('runs a command on a fresh client and formats the reply', async () => {
      fullData.current = { redisMode: 'command', command: 'GET', args: ['foo'], channels: [] }
      const client = new FakeRedis()
      client.callImpl = (command, ...args) => {
        expect(command).toBe('get')
        expect(args).toEqual(['foo'])
        return Promise.resolve('bar')
      }
      fakeClient.current = client

      const result = await redisExecutionService.runCommand({ requestId: 'cmd-1' })
      expect(result.success).toBe(true)
      expect(result.mode).toBe('command')
      expect(result.command).toBe('GET')
      expect(result.args).toEqual(['foo'])
      expect(result.reply).toBe('bar')
      expect(redisExecutionService.isActive('cmd-1')).toBe(false)
    })

    it('prefers the freeform override over the command palette', async () => {
      fullData.current = { redisMode: 'command', command: 'GET', args: ['ignored'], freeformCommand: 'SET foo "bar baz"', channels: [] }
      const client = new FakeRedis()
      client.callImpl = (command, ...args) => {
        expect(command).toBe('set')
        expect(args).toEqual(['foo', 'bar baz'])
        return Promise.resolve('OK')
      }
      fakeClient.current = client

      const result = await redisExecutionService.runCommand({ requestId: 'cmd-freeform' })
      expect(result.success).toBe(true)
      expect(result.command).toBe('SET')
      expect(result.reply).toBe('OK')
    })

    it('caps an unbounded XREAD BLOCK at the configured ceiling', async () => {
      fullData.current = { redisMode: 'command', freeformCommand: 'XREAD BLOCK 0 STREAMS mystream $', channels: [] }
      const client = new FakeRedis()
      let capturedArgs: string[] = []
      client.callImpl = (_command, ...args) => { capturedArgs = args; return Promise.resolve(null) }
      fakeClient.current = client

      const result = await redisExecutionService.runCommand({ requestId: 'cmd-xread' })
      expect(result.success).toBe(true)
      expect(capturedArgs).not.toContain('0')
      expect(capturedArgs[capturedArgs.indexOf('BLOCK') + 1]).toBe('5000')
      expect(result.reply).toBe('(nil)')
    })

    it('surfaces a command failure as a structured error, not a throw', async () => {
      fullData.current = { redisMode: 'command', command: 'GET', args: ['foo'], channels: [] }
      const client = new FakeRedis()
      client.callImpl = () => { throw Object.assign(new Error('boom'), { code: 'NOAUTH' }) }
      fakeClient.current = client

      const result = await redisExecutionService.runCommand({ requestId: 'cmd-err' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Authentication failed/)
    })

    it('rejects when neither a palette command nor a freeform override is set', async () => {
      fullData.current = { redisMode: 'command', args: [], channels: [] }
      const client = new FakeRedis()
      fakeClient.current = client

      const result = await redisExecutionService.runCommand({ requestId: 'cmd-none' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/No command to run/)
    })
  })

  describe('closeAll', () => {
    it('tears down every active connection', async () => {
      fullData.current = { redisMode: 'subscribe', channels: ['news'] }
      const client = new FakeRedis()
      fakeClient.current = client

      const resultPromise = redisExecutionService.subscribe({ requestId: 'sub-closeall' })
      await waitFor(() => client.listenerCount('ready') > 0)
      client.emit('ready')
      await waitFor(() => redisExecutionService.isActive('sub-closeall'))

      await redisExecutionService.closeAll()
      await resultPromise
      expect(redisExecutionService.isActive('sub-closeall')).toBe(false)
    })
  })
})

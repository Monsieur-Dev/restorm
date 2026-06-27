import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks for the Electron-facing + context surfaces the service touches.
// ---------------------------------------------------------------------------

// Capture every `webContents.send` so we can assert the broadcast channels.
const sent: { channel: string; payload: unknown }[] = []
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } } }
    ]
  }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

// A single in-memory request context the service resolves against.
const ctx = {
  url: 'http://localhost:4222/graphql',
  headers: [] as { key: string; value: string; enabled?: boolean }[],
  body: { query: 'subscription OnTick { ticks }', variables: '{}' }
}
vi.mock('./ContextService', () => ({
  contextService: {
    getResolvedUrl: () => ({ resolvedUrl: ctx.url }),
    getRequestContext: () => ({
      keyValueGroups: new Map([['headers', ctx.headers]]),
      fullData: {
        body: { type: 'text', content: JSON.stringify(ctx.body) }
      }
    }),
    collectEnvironmentSecrets: () => [],
    refreshEnvironmentContext: () => undefined,
    resolveValue: (v: string) => v,
    resolveKeyValueForRequest: (kv: { value: string }) => kv.value
  }
}))
vi.mock('./secrets/SecretHydrationService', () => ({
  secretHydrationService: { hydrate: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('./secrets/collectRequestSecrets', () => ({
  collectRequestSecrets: () => []
}))

// Mock graphql-sse: a controllable client whose sink we drive from the test.
let lastSink: { next: (v: unknown) => void; error: (e: unknown) => void; complete: () => void } | null = null
let lastRequest: { query: string; variables?: unknown; operationName?: string } | null = null
let lastOptions: { url: string; headers?: Record<string, string>; singleConnection?: boolean } | null = null
const dispose = vi.fn()
vi.mock('graphql-sse', () => ({
  createClient: (options: { url: string; headers?: Record<string, string>; singleConnection?: boolean }) => {
    lastOptions = options
    return {
      subscribe: (
        request: { query: string; variables?: unknown; operationName?: string },
        sink: { next: (v: unknown) => void; error: (e: unknown) => void; complete: () => void }
      ) => {
        lastRequest = request
        lastSink = sink
        return dispose
      }
    }
  }
}))

import {
  graphqlSubscriptionService,
  extractOperation,
  subscriptionErrorMessage
} from './GraphQLSubscriptionService'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  sent.length = 0
  lastSink = null
  lastRequest = null
  lastOptions = null
  dispose.mockClear()
  ctx.headers = []
  ctx.body = { query: 'subscription OnTick { ticks }', variables: '{}' }
})

describe('extractOperation', () => {
  it('parses a JSON body envelope into query + variables + operationName', () => {
    const body = JSON.stringify({ query: 'subscription S { x }', variables: '{"a":1}', operationName: 'S' })
    expect(extractOperation(body, '', '{}')).toEqual({
      query: 'subscription S { x }',
      variables: { a: 1 },
      operationName: 'S'
    })
  })

  it('drops empty variables and falls back to the discrete fields', () => {
    expect(extractOperation(undefined, 'subscription S { x }', '{}')).toEqual({ query: 'subscription S { x }' })
    expect(extractOperation(JSON.stringify({ query: 'subscription S { x }', variables: '{}' }), '', '{}')).toEqual({
      query: 'subscription S { x }'
    })
  })

  it('treats a non-JSON body as the raw query text', () => {
    expect(extractOperation('subscription S { x }', '', '{}')).toEqual({ query: 'subscription S { x }' })
  })
})

describe('subscriptionErrorMessage', () => {
  it('surfaces an Error message', () => {
    expect(subscriptionErrorMessage(new Error('boom'))).toBe('boom')
  })
  it('joins a GraphQL errors array', () => {
    expect(subscriptionErrorMessage([{ message: 'bad field' }, { message: 'oops' }])).toBe('bad field; oops')
  })
  it('falls back to a generic message for an empty payload', () => {
    expect(subscriptionErrorMessage(undefined)).toBe('Subscription error')
  })
})

describe('GraphQLSubscriptionService.connectStreaming', () => {
  it('opens a subscription, streams next events, and completes', async () => {
    const events: unknown[] = []
    let closedError: string | undefined = 'unset'
    let connected = false
    const handle = graphqlSubscriptionService.connectStreaming({
      requestId: 'r1',
      onConnect: () => { connected = true },
      onMessage: (p) => { events.push(p) },
      onClose: (e) => { closedError = e }
    })
    await flush()

    // Subscribed against the resolved endpoint, distinct-connections mode.
    expect(lastOptions?.url).toBe('http://localhost:4222/graphql')
    expect(lastOptions?.singleConnection).toBe(false)
    expect(lastRequest?.query).toBe('subscription OnTick { ticks }')
    expect(sent.some((s) => s.channel === 'graphql-sub:progress' && (s.payload as { status: string }).status === 'started')).toBe(true)
    expect(handle.isOpen()).toBe(true)

    // First pushed payload → connected + a broadcast event.
    lastSink?.next({ data: { ticks: 1 } })
    expect(connected).toBe(true)
    lastSink?.next({ data: { ticks: 2 } })
    expect(events).toEqual([{ data: { ticks: 1 } }, { data: { ticks: 2 } }])
    const eventBroadcasts = sent.filter((s) => s.channel === 'graphql-sub:event')
    expect(eventBroadcasts).toHaveLength(2)
    expect(JSON.parse((eventBroadcasts[0].payload as { event: { data: string } }).event.data)).toEqual({ data: { ticks: 1 } })

    // Server completes the stream → completed broadcast + onClose with no error.
    lastSink?.complete()
    expect(closedError).toBeUndefined()
    expect(sent.some((s) => s.channel === 'graphql-sub:progress' && (s.payload as { status: string }).status === 'completed')).toBe(true)
    expect(handle.isOpen()).toBe(false)
  })

  it('surfaces a transport/GraphQL error via onClose + an error broadcast', async () => {
    let closedError: string | undefined
    graphqlSubscriptionService.connectStreaming({
      requestId: 'r2',
      onConnect: () => undefined,
      onMessage: () => undefined,
      onClose: (e) => { closedError = e }
    })
    await flush()
    lastSink?.error([{ message: 'schema mismatch' }])
    expect(closedError).toBe('schema mismatch')
    expect(sent.some((s) => s.channel === 'graphql-sub:progress' && (s.payload as { status: string }).status === 'error')).toBe(true)
    expect(graphqlSubscriptionService.isActive('r2')).toBe(false)
  })

  it('unsubscribe() disposes the stream and reports a cancellation', async () => {
    let closedError: string | undefined = 'unset'
    const handle = graphqlSubscriptionService.connectStreaming({
      requestId: 'r3',
      onConnect: () => undefined,
      onMessage: () => undefined,
      onClose: (e) => { closedError = e }
    })
    await flush()
    expect(graphqlSubscriptionService.isActive('r3')).toBe(true)

    const stopped = graphqlSubscriptionService.unsubscribe('r3')
    expect(stopped).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(graphqlSubscriptionService.isActive('r3')).toBe(false)
    expect(handle.isOpen()).toBe(false)
    expect(sent.some((s) => s.channel === 'graphql-sub:progress' && (s.payload as { status: string }).status === 'cancelled')).toBe(true)

    // graphql-sse fires `complete` on dispose; the close must report cancelled
    // (closedByCaller), not a spurious error.
    lastSink?.complete()
    expect(closedError).toBeUndefined()
  })

  it('forwards resolved headers to the SSE client', async () => {
    ctx.headers = [{ key: 'Authorization', value: 'Bearer t', enabled: true }, { key: 'X-Off', value: 'no', enabled: false }]
    graphqlSubscriptionService.connectStreaming({
      requestId: 'r4',
      onConnect: () => undefined,
      onMessage: () => undefined,
      onClose: () => undefined
    })
    await flush()
    expect(lastOptions?.headers).toEqual({ Authorization: 'Bearer t' })
  })
})

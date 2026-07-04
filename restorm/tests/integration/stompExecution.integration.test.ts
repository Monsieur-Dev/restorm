/**
 * Integration test for STOMP execution through `StompExecutionService`.
 * Connects to the real Docker ActiveMQ broker
 * (`tests/docker/docker-compose.yml`, `rmohr/activemq` on :61614) and proves
 * the CONNECT/SUBSCRIBE/receive loop: connect, subscribe to a destination,
 * push a message from a separate raw-frame publisher, and receive it.
 *
 * Requires the broker — run under `pnpm docker:up` (CI does this). Only the
 * surrounding singletons (ContextService / history / secrets / electron /
 * logger) are stubbed, mirroring `mqttExecution.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import net from 'node:net'
import WebSocket from 'ws'
import { encodeStompFrame, parseStompFrames } from '../../src/main/services/stomp/stompFrame'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: () => undefined } }] },
  app: { isPackaged: false, getPath: () => '/tmp' }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypassSync: <T>(fn: () => T): T => fn()
}))
vi.mock('../../src/main/services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('../../src/main/services/secrets/SecretHydrationService', () => ({
  secretHydrationService: { hydrate: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('../../src/main/services/secrets/collectRequestSecrets', () => ({
  collectRequestSecrets: () => []
}))
vi.mock('../../src/main/services/ContextService', () => ({
  contextService: {
    getResolvedUrl: vi.fn(),
    getRequestContext: vi.fn(),
    collectEnvironmentSecrets: () => [],
    refreshEnvironmentContext: vi.fn(),
    resolveKeyValueForRequest: (h: { value: unknown }) => String(h.value),
    resolveValue: (m: string) => m
  }
}))

import { stompExecutionService } from '../../src/main/services/StompExecutionService'
import { contextService } from '../../src/main/services/ContextService'

const BROKER_URL = 'ws://localhost:61614'
const BROKER_PORT = 61614

interface StompStub {
  url?: string
  subscriptions?: { id: string; destination: string; ackMode?: string }[]
  sendDestination?: string
  sendBody?: string
}

const stubbed = new Map<string, StompStub>()
function installStubs(): void {
  vi.mocked(contextService.getResolvedUrl).mockImplementation(
    (id: string) => { const s = stubbed.get(id); return (s ? { resolvedUrl: s.url ?? BROKER_URL } : undefined) as never }
  )
  vi.mocked(contextService.getRequestContext).mockImplementation(
    (id: string) => {
      const s = stubbed.get(id)
      if (!s) return undefined as never
      return {
        fullData: {
          stompVersion: '1.2',
          connectHeaders: [],
          subscriptions: s.subscriptions ?? [],
          sendDestination: s.sendDestination ?? '',
          sendBody: s.sendBody ?? '',
          sendHeaders: []
        },
        keyValueGroups: new Map()
      } as never
    }
  )
}
function stub(id: string, s: StompStub): void { stubbed.set(id, s) }

async function waitFor(pred: () => boolean, ms = 6000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** A throwaway raw STOMP client used to push messages at the broker,
 * independent of the service under test. */
function rawStompPublisher(connectTimeoutMs = 4000): Promise<{ send: (destination: string, body: string) => void; close: () => void }> {
  return new Promise((resolve, reject) => {
    // Same subprotocol requirement as `StompExecutionService.open` — ActiveMQ
    // offers `vNN.stomp` and `ws` rejects an unrequested server subprotocol.
    const ws = new WebSocket(BROKER_URL, ['v12.stomp', 'v11.stomp', 'v10.stomp'])
    // Bound the handshake so a not-yet-ready broker (socket open but STOMP
    // transport still warming up) rejects promptly instead of hanging the caller.
    const timer = setTimeout(() => { try { ws.close() } catch { /* noop */ } reject(new Error('STOMP connect timeout')) }, connectTimeoutMs)
    ws.on('open', () => {
      ws.send(encodeStompFrame({ command: 'CONNECT', headers: { 'accept-version': '1.2', host: '/' }, body: '' }))
    })
    ws.on('message', (data: WebSocket.Data) => {
      // Same explicit-branches fix as StompExecutionService.ts's handler —
      // `String(data)` stringifies an `ArrayBuffer`/fragmented `Buffer[]` to
      // `[object Object]`/`[object ArrayBuffer]` instead of the frame text.
      const text = typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.from(data).toString('utf8')
      for (const frame of parseStompFrames(text)) {
        if (frame.command === 'CONNECTED') {
          clearTimeout(timer)
          resolve({
            send: (destination, body) => { ws.send(encodeStompFrame({ command: 'SEND', headers: { destination }, body })) },
            close: () => { ws.close() }
          })
        }
        if (frame.command === 'ERROR') { clearTimeout(timer); reject(new Error(frame.body || 'CONNECT rejected')) }
      }
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

/** TCP-probe the broker so the suite is a no-op when it's absent, mirroring
 * `mqttExecution.integration.test.ts`'s `brokerReachable`. */
function brokerReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(BROKER_PORT, 'localhost')
    const done = (ok: boolean): void => { sock.destroy(); resolve(ok) }
    sock.setTimeout(2000)
    sock.once('connect', () => { done(true) })
    sock.once('error', () => { done(false) })
    sock.once('timeout', () => { done(false) })
  })
}

describe('StompExecutionService — STOMP execution', () => {
  let brokerAvailable = false
  const publishers: { close: () => void }[] = []
  beforeAll(async () => {
    // TCP-reachable != STOMP-ready: a freshly (re)started ActiveMQ (e.g. a cold
    // CI mock) accepts the socket seconds before its STOMP transport can
    // complete a CONNECT, and a SUBSCRIBE against that not-yet-ready broker is
    // silently dropped. Poll a real CONNECT/CONNECTED handshake until it
    // succeeds (bounded) so the suite runs against a genuinely ready broker
    // instead of racing its warm-up.
    if (!(await brokerReachable())) return
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      try {
        const probe = await rawStompPublisher(3000)
        probe.close()
        brokerAvailable = true
        return
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }, 30000)
  afterEach(async () => {
    for (const id of [...stubbed.keys()]) { try { stompExecutionService.disconnect(id) } catch { /* noop */ } }
    for (const p of publishers) { try { p.close() } catch { /* noop */ } }
    publishers.length = 0
    stubbed.clear()
    vi.clearAllMocks()
    installStubs()
    await new Promise((r) => setTimeout(r, 50))
  })

  it('connects, does the CONNECT/CONNECTED handshake, and reports connected: true', async () => {
    if (!brokerAvailable) return
    installStubs()
    stub('s1', {})
    const result = await stompExecutionService.execute({ requestId: 's1', timeout: 4000 })
    expect(result.connected).toBe(true)
    expect(result.success).toBe(true)
    expect(result.messages.some((m) => m.command === 'CONNECTED')).toBe(true)
  })

  it('subscribes to a destination and receives a message pushed by a separate publisher', async () => {
    if (!brokerAvailable) return
    installStubs()
    const destination = `/topic/restorm-it-${Date.now()}`
    stub('s2', { subscriptions: [{ id: 'sub-0', destination, ackMode: 'auto' }] })
    const run = stompExecutionService.execute({ requestId: 's2', timeout: 10000 })
    await waitFor(() => stompExecutionService.isActive('s2'))

    const publisher = await rawStompPublisher()
    publishers.push(publisher)

    // A STOMP topic drops any message published before the broker finishes
    // registering the SUBSCRIBE; `isActive('s2')` only confirms the client SENT
    // the subscribe frame, not that the broker processed it. Re-publish on a
    // short interval until the message is observed, so a cold broker's
    // subscription-registration lag can't swallow a single race-y send.
    const frameArrived = (): boolean => (stompExecutionService.getMessages('s2')?.frames ?? []).some(
      (m) => m.direction === 'received' && m.command === 'MESSAGE' && m.body === 'hello-from-integration-test'
    )
    const publishStart = Date.now()
    while (!frameArrived()) {
      if (Date.now() - publishStart > 8000) throw new Error('waitFor timed out')
      publisher.send(destination, 'hello-from-integration-test')
      await new Promise((r) => setTimeout(r, 200))
    }
    stompExecutionService.disconnect('s2')
    const result = await run
    const received = result.messages.find((m) => m.direction === 'received' && m.command === 'MESSAGE')
    expect(received?.destination).toBe(destination)
    expect(received?.subscription).toBe('sub-0')
    expect(received?.body).toBe('hello-from-integration-test')
  })

  it('the Send button (send()) publishes to its own subscription and round-trips back', async () => {
    if (!brokerAvailable) return
    installStubs()
    const destination = `/topic/restorm-it-send-${Date.now()}`
    stub('s3', { subscriptions: [{ id: 'sub-0', destination, ackMode: 'auto' }] })
    const run = stompExecutionService.execute({ requestId: 's3', timeout: 6000 })
    await waitFor(() => stompExecutionService.isActive('s3'))

    expect(stompExecutionService.send('s3', 'round-trip-body', destination)).toBe(true)

    await waitFor(() => (stompExecutionService.getMessages('s3')?.frames ?? []).some(
      (m) => m.direction === 'received' && m.command === 'MESSAGE' && m.body === 'round-trip-body'
    ))
    stompExecutionService.disconnect('s3')
    await run
  })
})

// @vitest-environment node
/**
 * Streaming MQTT connect-timer hardening: when the client is ended (Stop) BEFORE
 * it ever connects, the still-armed connect timer must be cleared by the `'end'`
 * handler — otherwise it later fires a stray 'error' connection-progress event
 * (cosmetic but wrong: a clean Stop must not surface as an error).
 *
 * Uses a fake mqtt client (never emits 'connect') + fake timers so the timeout
 * window is crossed deterministically without a real broker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Capture every connection-progress broadcast so we can assert no post-'end'
// 'error' status leaks through.
const progress = vi.hoisted(() => [] as { requestId: string; status: string }[])
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      webContents: {
        send: (channel: string, payload: { requestId: string; status: string }) => {
          if (channel === 'websocket:connection-progress') progress.push(payload)
        }
      }
    }]
  },
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
    getResolvedUrl: vi.fn(() => ({ resolvedUrl: 'mqtt://localhost:1883' })),
    getRequestContext: vi.fn(() => ({ fullData: { protocol: 'mqtt', server: false }, keyValueGroups: new Map() })),
    collectEnvironmentSecrets: () => [],
    refreshEnvironmentContext: vi.fn(),
    resolveKeyValueForRequest: (h: { value: unknown }) => String(h.value),
    resolveValue: (m: string) => m
  }
}))

// A fake mqtt client that NEVER connects; `end()` fires 'end' like mqtt.js's
// force-end does on disconnect.
class FakeMqttClient extends EventEmitter {
  ended = false
  end(_force?: boolean): this {
    this.ended = true
    queueMicrotask(() => this.emit('end'))
    return this
  }
  subscribe(): this { return this }
  publish(): this { return this }
}
const fakeClient = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => fakeClient.current) },
  connect: vi.fn(() => fakeClient.current)
}))

import { websocketExecutionService } from '../../src/main/services/WebSocketExecutionService'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const waitFor = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await sleep(5)
  }
}

describe('streaming MQTT — connect timer cleared on end (no stray post-close error)', () => {
  beforeEach(() => { progress.length = 0 })
  afterEach(() => { vi.clearAllMocks() })

  it('a Stop before connect does not fire an error progress after the timeout window', async () => {
    const client = new FakeMqttClient()
    fakeClient.current = client

    // A connect timeout wide enough that we can Stop well before it fires, then
    // cross the window to prove the cleared timer never fires afterward.
    const TIMEOUT = 1000
    let closed = false
    const handle = websocketExecutionService.connectStreamingMqtt({
      requestId: 'mqtt-stop-before-connect',
      onConnect: () => undefined,
      onMessage: () => undefined,
      onClose: () => { closed = true },
      timeout: TIMEOUT
    })

    // Wait for the 'started' progress — broadcast right after the connection is
    // registered + the connect timer armed (deterministic, not a wall-clock
    // guess; the 1s timeout can't fire before this). isActive() stays false for
    // mqtt until 'connect', which our fake never emits — so we key off 'started'.
    await waitFor(() => progress.some((p) => p.requestId === 'mqtt-stop-before-connect' && p.status === 'started'), 5000)

    // Stop before the broker ever connects → 'end' fires → fireClose() + the
    // timer must be cleared.
    handle.close()
    await waitFor(() => closed)
    expect(websocketExecutionService.isActive('mqtt-stop-before-connect')).toBe(false)

    // Sleep past the original connect-timeout window: if the timer had NOT been
    // cleared on 'end', it would now fire and broadcast an 'error' progress.
    await sleep(TIMEOUT + 100)

    expect(progress.some((p) => p.requestId === 'mqtt-stop-before-connect' && p.status === 'error')).toBe(false)
    // The clean stop's only terminal status is 'completed' (from the 'end' path).
    expect(progress.filter((p) => p.requestId === 'mqtt-stop-before-connect').map((p) => p.status)).toContain('completed')
  })
})

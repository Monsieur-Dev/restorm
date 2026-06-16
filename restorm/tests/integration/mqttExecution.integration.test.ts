/**
 * Integration test for MQTT execution through `WebSocketExecutionService` (the
 * same code path the request panel drives via `protocol === 'mqtt'`). Connects
 * to the real Docker Mosquitto broker (`tests/docker/docker-compose.yml`,
 * eclipse-mosquitto on :1883) and proves the publish/subscribe loop: connect,
 * subscribe to the request's topic, publish via the Send button (`send()`),
 * receive matching frames (incl. wildcards + retained), and surface auth errors.
 *
 * Requires the broker — run under `pnpm docker:up` (CI does this). Only the
 * surrounding singletons (ContextService / history / secrets / electron /
 * logger) are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import mqtt, { type MqttClient } from 'mqtt'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: () => undefined } }] },
  app: { isPackaged: false, getPath: () => '/tmp' }
}))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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

import { websocketExecutionService, type WebSocketExecutionResult } from '../../src/main/services/WebSocketExecutionService'
import { contextService } from '../../src/main/services/ContextService'

const BROKER = 'mqtt://localhost:1883'

interface MqttStub {
  url?: string
  topic?: string
  qos?: number
  retain?: boolean
  username?: string
  password?: string
  mqttSubscribe?: boolean
  lwtTopic?: string
  lwtPayload?: string
  lwtQos?: number
  lwtRetain?: boolean
}

const stubbed = new Map<string, MqttStub>()
function installStubs(): void {
  vi.mocked(contextService.getResolvedUrl).mockImplementation(
    (id: string) => { const s = stubbed.get(id); return (s ? { resolvedUrl: s.url ?? BROKER } : undefined) as never }
  )
  vi.mocked(contextService.getRequestContext).mockImplementation(
    (id: string) => {
      const s = stubbed.get(id)
      if (!s) return undefined as never
      return {
        fullData: {
          protocol: 'mqtt',
          event: s.topic,
          message: '{}',
          ...(s.qos !== undefined ? { qos: s.qos } : {}),
          ...(s.retain !== undefined ? { retain: s.retain } : {}),
          ...(s.username !== undefined ? { username: s.username } : {}),
          ...(s.password !== undefined ? { password: s.password } : {}),
          ...(s.mqttSubscribe !== undefined ? { mqttSubscribe: s.mqttSubscribe } : {}),
          ...(s.lwtTopic !== undefined ? { lwtTopic: s.lwtTopic } : {}),
          ...(s.lwtPayload !== undefined ? { lwtPayload: s.lwtPayload } : {}),
          ...(s.lwtQos !== undefined ? { lwtQos: s.lwtQos } : {}),
          ...(s.lwtRetain !== undefined ? { lwtRetain: s.lwtRetain } : {})
        },
        keyValueGroups: new Map()
      } as never
    }
  )
}
function stub(id: string, s: MqttStub): void { stubbed.set(id, s) }

async function waitFor(pred: () => boolean, ms = 6000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** A throwaway raw publisher used to drive messages at the broker. */
function rawClient(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(BROKER, { reconnectPeriod: 0, connectTimeout: 4000 })
    c.on('connect', () => { resolve(c) })
    c.on('error', reject)
  })
}

describe('WebSocketExecutionService — MQTT execution', () => {
  const raws: MqttClient[] = []
  beforeEach(() => { installStubs() })
  afterEach(async () => {
    for (const id of [...stubbed.keys()]) { try { websocketExecutionService.disconnect(id) } catch { /* noop */ } }
    for (const c of raws) { try { c.end(true) } catch { /* noop */ } }
    raws.length = 0
    stubbed.clear()
    vi.clearAllMocks()
    // let the broker settle between tests
    await new Promise((r) => setTimeout(r, 50))
  })

  it('connects, subscribes to its topic, and surfaces a published message (QoS 1)', async () => {
    const topic = `restorm/it/echo-${Date.now()}`
    stub('m1', { topic, qos: 1 })
    const run = websocketExecutionService.execute({ requestId: 'm1' })
    await waitFor(() => websocketExecutionService.isActive('m1'))

    // A separate publisher pushes to the subscribed topic.
    const pub = await rawClient(); raws.push(pub)
    pub.publish(topic, JSON.stringify({ hello: 'mqtt' }), { qos: 1 })

    await waitFor(() => (websocketExecutionService.getMessages('m1')?.frames ?? []).some((m) => m.event === topic && m.data.includes('mqtt')))
    websocketExecutionService.disconnect('m1')
    const result = await run
    expect(result.connected).toBe(true)
    expect(result.messages.some((m) => m.event === topic && m.data.includes('mqtt'))).toBe(true)
  })

  it('subscribes + receives an exactly-once (QoS 2) message', async () => {
    const topic = `restorm/it/qos2-${Date.now()}`
    stub('m8', { topic, qos: 2 })
    const run = websocketExecutionService.execute({ requestId: 'm8' })
    await waitFor(() => websocketExecutionService.isActive('m8'))

    const pub = await rawClient(); raws.push(pub)
    pub.publish(topic, JSON.stringify({ hello: 'qos2' }), { qos: 2 })

    await waitFor(() => (websocketExecutionService.getMessages('m8')?.frames ?? []).some((m) => m.event === topic && m.data.includes('qos2')))
    websocketExecutionService.disconnect('m8')
    const result = await run
    expect(result.messages.some((m) => m.event === topic && m.data.includes('qos2'))).toBe(true)
  })

  it('publishes the configured Last Will & Testament when the connection drops ungracefully', async () => {
    const willTopic = `restorm/it/lwt-${Date.now()}`
    // A bystander subscriber waiting for the broker to fire the will.
    const sub = await rawClient(); raws.push(sub)
    const willMsgs: string[] = []
    sub.on('message', (t, p) => { if (t === willTopic) willMsgs.push(p.toString()) })
    await new Promise<void>((res, rej) => { sub.subscribe(willTopic, { qos: 1 }, (e) => { if (e) rej(e); else res() }) })

    // The service connects with a will registered on `willTopic`.
    stub('m9', { topic: `restorm/it/lwt-data-${Date.now()}`, qos: 0, lwtTopic: willTopic, lwtPayload: 'client-gone' })
    const run = websocketExecutionService.execute({ requestId: 'm9' })
    await waitFor(() => websocketExecutionService.isActive('m9'))

    // disconnect() force-closes the socket (`end(true)`) WITHOUT a clean
    // DISCONNECT packet, so the broker treats it as a drop and fires the will.
    websocketExecutionService.disconnect('m9')
    await waitFor(() => willMsgs.includes('client-gone'))
    await run // drain the execution promise (the will assertion is the waitFor above)
  })

  it('the Send button publishes to the topic (round-trips back via the subscription)', async () => {
    const topic = `restorm/it/send-${Date.now()}`
    stub('m2', { topic, qos: 0 })
    const run = websocketExecutionService.execute({ requestId: 'm2' })
    await waitFor(() => websocketExecutionService.isActive('m2'))

    // Publish through the service's own client (Send button path) — it is also
    // subscribed to the topic, so the frame comes back as received.
    expect(websocketExecutionService.send('m2', JSON.stringify({ from: 'send' }), topic)).toBe(true)
    await waitFor(() => (websocketExecutionService.getMessages('m2')?.frames ?? []).some((m) => m.direction === 'received' && m.data.includes('send')))
    websocketExecutionService.disconnect('m2')
    await run
  })

  it('receives messages on a single-level (+) and multi-level (#) wildcard subscription', async () => {
    const base = `restorm/it/wild-${Date.now()}`
    stub('m3', { topic: `${base}/+/leaf`, qos: 0 })
    const run = websocketExecutionService.execute({ requestId: 'm3' })
    await waitFor(() => websocketExecutionService.isActive('m3'))

    const pub = await rawClient(); raws.push(pub)
    pub.publish(`${base}/branch/leaf`, 'plus-match', { qos: 0 })
    await waitFor(() => (websocketExecutionService.getMessages('m3')?.frames ?? []).some((m) => m.data === 'plus-match'))
    websocketExecutionService.disconnect('m3')
    await run

    stub('m4', { topic: `${base}/#`, qos: 0 })
    const run2 = websocketExecutionService.execute({ requestId: 'm4' })
    await waitFor(() => websocketExecutionService.isActive('m4'))
    const pub2 = await rawClient(); raws.push(pub2)
    pub2.publish(`${base}/deep/nested/leaf`, 'hash-match', { qos: 0 })
    await waitFor(() => (websocketExecutionService.getMessages('m4')?.frames ?? []).some((m) => m.data === 'hash-match'))
    websocketExecutionService.disconnect('m4')
    await run2
  })

  it('receives a retained message published before it subscribed', async () => {
    const topic = `restorm/it/retain-${Date.now()}`
    const pub = await rawClient(); raws.push(pub)
    pub.publish(topic, 'retained-payload', { qos: 1, retain: true })
    await new Promise((r) => setTimeout(r, 100)) // let the broker store it

    stub('m5', { topic, qos: 1 })
    const run = websocketExecutionService.execute({ requestId: 'm5' })
    await waitFor(() => (websocketExecutionService.getMessages('m5')?.frames ?? []).some((m) => m.data === 'retained-payload'))
    websocketExecutionService.disconnect('m5')
    await run
    // Clear the retained message so re-runs stay clean.
    pub.publish(topic, '', { qos: 1, retain: true })
  })

  it('connects with valid username/password', async () => {
    const topic = `restorm/it/auth-${Date.now()}`
    stub('m6', { topic, username: 'restorm', password: 'restorm' })
    const run = websocketExecutionService.execute({ requestId: 'm6' })
    await waitFor(() => websocketExecutionService.isActive('m6'))
    expect(websocketExecutionService.isActive('m6')).toBe(true)
    websocketExecutionService.disconnect('m6')
    const result = await run
    expect(result.connected).toBe(true)
  })

  it('surfaces an auth error for bad credentials (and does not retry forever)', async () => {
    stub('m7', { topic: 'restorm/it/bad', username: 'restorm', password: 'wrong' })
    const result: WebSocketExecutionResult = await websocketExecutionService.execute({ requestId: 'm7', timeout: 4000 })
    expect(result.connected).toBe(false)
    expect(result.success).toBe(false)
    expect(result.error ?? '').not.toBe('')
    expect(websocketExecutionService.isActive('m7')).toBe(false)
  })
})

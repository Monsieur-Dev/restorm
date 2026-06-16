/**
 * Integration test for restorm acting AS a Socket.IO server.
 *
 * Hosts the real server through `WebSocketExecutionService` (the same code the
 * request panel and the scenario engine drive) and connects a real
 * `socket.io-client` to it — proving the full loop: the server ACKs every
 * received event on reception, records it as a received frame, and broadcasts
 * the GUI payload to connected clients. Only the surrounding singletons
 * (ContextService / history / secrets / electron / logger) are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer } from 'node:net'
import { io as clientIo, type Socket } from 'socket.io-client'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
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

import { websocketExecutionService } from '../../src/main/services/WebSocketExecutionService'
import { contextService } from '../../src/main/services/ContextService'

/** Reserve, then immediately release, an OS-assigned port so the hosted server
 * can bind a guaranteed-free port (singleFork integration run = no race). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', (e) => { reject(e) })
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => { resolve(port) })
    })
  })
}

async function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Whether `port` is bindable right now (i.e. NOT held by a listener). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.unref()
    srv.once('error', () => { resolve(false) })
    srv.listen(port, '127.0.0.1', () => { srv.close(() => { resolve(true) }) })
  })
}

/** Poll until `port` reaches the expected bound/free state (the OS socket close
 * after a route stops is async, so a positive "freed" check must wait it out). */
async function waitForPortFree(port: number, free: boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while ((await isPortFree(port)) !== free) {
    if (Date.now() - start > ms) throw new Error(`port ${port} never became ${free ? 'free' : 'bound'}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

// Per-requestId stub registry so several server requests can be hosted at once
// (the multi-route / collision tests need distinct URLs keyed by request id).
const stubbed = new Map<string, { url: string; message: string }>()
function installContextStubs(): void {
  vi.mocked(contextService.getResolvedUrl).mockImplementation(
    (id: string) => { const s = stubbed.get(id); return (s ? { resolvedUrl: s.url } : undefined) as never }
  )
  vi.mocked(contextService.getRequestContext).mockImplementation(
    (id: string) => {
      const s = stubbed.get(id)
      return (s ? { fullData: { server: true, protocol: 'socketio', message: s.message }, keyValueGroups: new Map() } : undefined) as never
    }
  )
}

/** Throwaway callback for server handles whose lifecycle a test doesn't assert. */
const noop = (): void => undefined
function stubServerRequest(id: string, url: string, message = '{}'): void {
  stubbed.set(id, { url, message })
}

describe('WebSocketExecutionService — Socket.IO server mode', () => {
  const clients: Socket[] = []
  beforeEach(() => { installContextStubs() })
  afterEach(() => {
    for (const c of clients) { try { c.close() } catch { /* noop */ } }
    clients.length = 0
    stubbed.clear()
    vi.clearAllMocks()
  })

  it('connectStreamingServer: ACKs received events, records them, and broadcasts to clients', async () => {
    const port = await freePort()
    stubServerRequest('srv-stream', `localhost:${port}`)

    const received: { ev: string | undefined; payload: unknown }[] = []
    let connected = false
    let closed = false
    let closeErr: string | undefined
    const handle = websocketExecutionService.connectStreamingServer({
      requestId: 'srv-stream',
      onConnect: () => { connected = true },
      onMessage: (ev, payload) => { received.push({ ev, payload }) },
      onClose: (e) => { closed = true; closeErr = e }
    })
    await waitFor(() => connected)
    expect(websocketExecutionService.isActive('srv-stream')).toBe(true)

    const client = clientIo(`http://127.0.0.1:${port}`, { reconnection: false, forceNew: true })
    clients.push(client)
    await waitFor(() => client.connected)

    // A client emit-with-ack resolves with the server's reception ACK.
    const ack = await new Promise((resolve) => { client.emit('hello', { a: 1 }, resolve) })
    expect(ack).toEqual({ ack: true, event: 'hello' })
    await waitFor(() => received.length >= 1)
    expect(received[0]).toEqual({ ev: 'hello', payload: { a: 1 } })

    // The server's Send button broadcasts the GUI payload to every client.
    const broadcast = await new Promise((resolve) => {
      client.on('greet', (d: unknown) => { resolve(d) })
      expect(handle.send('greet', '{"x":2}')).toBe(true)
    })
    expect(broadcast).toEqual({ x: 2 })

    handle.close()
    await waitFor(() => closed)
    expect(closeErr).toBeUndefined()
    expect(websocketExecutionService.isActive('srv-stream')).toBe(false)
  })

  it('execute(): hosts the server (request-panel path) and resolves on disconnect with the received frames', async () => {
    const port = await freePort()
    stubServerRequest('srv-exec', `localhost:${port}`)

    const runPromise = websocketExecutionService.execute({ requestId: 'srv-exec' })
    await waitFor(() => websocketExecutionService.isActive('srv-exec'))

    const client = clientIo(`http://127.0.0.1:${port}`, { reconnection: false, forceNew: true })
    clients.push(client)
    await waitFor(() => client.connected)
    await new Promise((resolve) => { client.emit('ping', { n: 7 }, resolve) })

    // Stop listening → the run resolves with the recorded frames.
    websocketExecutionService.disconnect('srv-exec')
    const result = await runPromise
    expect(result.success).toBe(true)
    const events = result.messages.map((m) => m.event)
    expect(events).toContain('connection')
    expect(events).toContain('ping')
    const ping = result.messages.find((m) => m.event === 'ping')
    expect(ping?.data).toBe(JSON.stringify({ n: 7 }))
  })

  it('two routes (distinct namespaces) share ONE port; each client reaches its own route', async () => {
    const port = await freePort()
    stubServerRequest('srv-root', `localhost:${port}`)        // namespace "/"
    stubServerRequest('srv-chat', `localhost:${port}/chat`)   // namespace "/chat"

    const rootMsgs: unknown[] = []
    const chatMsgs: unknown[] = []
    let rootUp = false
    let chatUp = false
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-root', onConnect: () => { rootUp = true }, onMessage: (_e, p) => { rootMsgs.push(p) }, onClose: noop
    })
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-chat', onConnect: () => { chatUp = true }, onMessage: (_e, p) => { chatMsgs.push(p) }, onClose: noop
    })
    await waitFor(() => rootUp && chatUp)
    // Both routes listen on the SAME port.
    expect(websocketExecutionService.isActive('srv-root')).toBe(true)
    expect(websocketExecutionService.isActive('srv-chat')).toBe(true)

    const rootClient = clientIo(`http://127.0.0.1:${port}`, { reconnection: false, forceNew: true })
    const chatClient = clientIo(`http://127.0.0.1:${port}/chat`, { reconnection: false, forceNew: true })
    clients.push(rootClient, chatClient)
    await waitFor(() => rootClient.connected && chatClient.connected)

    await new Promise((r) => { rootClient.emit('toRoot', { who: 'root' }, r) })
    await new Promise((r) => { chatClient.emit('toChat', { who: 'chat' }, r) })
    await waitFor(() => rootMsgs.length >= 1 && chatMsgs.length >= 1)

    // Each route only sees its own client's traffic — namespaces are isolated.
    expect(rootMsgs).toEqual([{ who: 'root' }])
    expect(chatMsgs).toEqual([{ who: 'chat' }])

    // Closing one route leaves the other (and the shared port) up.
    websocketExecutionService.disconnect('srv-root')
    await waitFor(() => !websocketExecutionService.isActive('srv-root'))
    expect(websocketExecutionService.isActive('srv-chat')).toBe(true)
    websocketExecutionService.disconnect('srv-chat')
    await waitFor(() => !websocketExecutionService.isActive('srv-chat'))
  })

  it('two IDENTICAL routes (same namespace + port) collide: the first listens, the second fails', async () => {
    const port = await freePort()
    stubServerRequest('srv-a', `localhost:${port}`)
    stubServerRequest('srv-b', `localhost:${port}`) // same port + default namespace

    let aUp = false
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-a', onConnect: () => { aUp = true }, onMessage: noop, onClose: noop
    })
    await waitFor(() => aUp)

    let bErr: string | undefined
    let bClosed = false
    let bUp = false
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-b', onConnect: () => { bUp = true }, onMessage: noop, onClose: (e) => { bClosed = true; bErr = e }
    })
    await waitFor(() => bClosed)
    // The second route never came up; it reported a route-collision error.
    expect(bUp).toBe(false)
    expect(bErr).toMatch(/already listening/i)
    // The first route is untouched and still listening.
    expect(websocketExecutionService.isActive('srv-a')).toBe(true)

    websocketExecutionService.disconnect('srv-a')
    await waitFor(() => !websocketExecutionService.isActive('srv-a'))
  })

  it('close() during startup releases the port (no leak) — a fresh server can rebind it', async () => {
    const port = await freePort()
    stubServerRequest('srv-early', `localhost:${port}`)
    let closed = false
    const handle = websocketExecutionService.connectStreamingServer({
      requestId: 'srv-early', onConnect: noop, onMessage: noop, onClose: () => { closed = true }
    })
    handle.close() // Stop before it finishes binding — must not leave a listener.
    await waitFor(() => closed)
    expect(websocketExecutionService.isActive('srv-early')).toBe(false)

    // If the early close had leaked the port, this rebind would EADDRINUSE and
    // never come up. It coming up proves the port was released.
    stubServerRequest('srv-reuse', `localhost:${port}`)
    let up = false
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-reuse', onConnect: () => { up = true }, onMessage: noop, onClose: noop
    })
    await waitFor(() => up)
    expect(websocketExecutionService.isActive('srv-reuse')).toBe(true)
    websocketExecutionService.disconnect('srv-reuse')
    await waitFor(() => !websocketExecutionService.isActive('srv-reuse'))
  })

  it('closeAll() tears down every hosted server (file close / quit)', async () => {
    const portA = await freePort()
    const portB = await freePort()
    stubServerRequest('srv-x', `localhost:${portA}`)
    stubServerRequest('srv-y', `localhost:${portB}/chat`)
    let xUp = false, yUp = false, xClosed = false, yClosed = false
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-x', onConnect: () => { xUp = true }, onMessage: noop, onClose: () => { xClosed = true }
    })
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-y', onConnect: () => { yUp = true }, onMessage: noop, onClose: () => { yClosed = true }
    })
    await waitFor(() => xUp && yUp)

    // Closing the project tears down BOTH hosted servers (no leaked listener).
    websocketExecutionService.closeAll()
    await waitFor(() => xClosed && yClosed)
    expect(websocketExecutionService.isActive('srv-x')).toBe(false)
    expect(websocketExecutionService.isActive('srv-y')).toBe(false)

    // Ports released — both rebind cleanly.
    stubServerRequest('srv-x2', `localhost:${portA}`)
    let x2Up = false
    websocketExecutionService.connectStreamingServer({
      requestId: 'srv-x2', onConnect: () => { x2Up = true }, onMessage: noop, onClose: noop
    })
    await waitFor(() => x2Up)
    expect(websocketExecutionService.isActive('srv-x2')).toBe(true)
    websocketExecutionService.disconnect('srv-x2')
    await waitFor(() => !websocketExecutionService.isActive('srv-x2'))
  })

  it('port-release timing: a sole route frees the port; with several, the port is held until the LAST stops', async () => {
    // Scenario 1 — one route on a port: stopping it frees the OS port.
    const p1 = await freePort()
    stubServerRequest('solo', `localhost:${p1}/xxx`)
    let soloUp = false
    websocketExecutionService.connectStreamingServer({ requestId: 'solo', onConnect: () => { soloUp = true }, onMessage: noop, onClose: noop })
    await waitFor(() => soloUp)
    expect(await isPortFree(p1)).toBe(false) // bound while listening
    websocketExecutionService.disconnect('solo')
    await waitFor(() => !websocketExecutionService.isActive('solo'))
    await waitForPortFree(p1, true) // freed once the sole route stops

    // Scenario 2 — two routes (xxx + zzz) share ONE port.
    const p2 = await freePort()
    stubServerRequest('rt-xxx', `localhost:${p2}/xxx`)
    stubServerRequest('rt-zzz', `localhost:${p2}/zzz`)
    let xUp = false, zUp = false
    websocketExecutionService.connectStreamingServer({ requestId: 'rt-xxx', onConnect: () => { xUp = true }, onMessage: noop, onClose: noop })
    websocketExecutionService.connectStreamingServer({ requestId: 'rt-zzz', onConnect: () => { zUp = true }, onMessage: noop, onClose: noop })
    await waitFor(() => xUp && zUp)

    // Stopping xxx must NOT free the port — zzz still holds it.
    websocketExecutionService.disconnect('rt-xxx')
    await waitFor(() => !websocketExecutionService.isActive('rt-xxx'))
    expect(websocketExecutionService.isActive('rt-zzz')).toBe(true)
    expect(await isPortFree(p2)).toBe(false) // STILL bound (zzz)

    // Stopping zzz (the LAST route) frees the port.
    websocketExecutionService.disconnect('rt-zzz')
    await waitFor(() => !websocketExecutionService.isActive('rt-zzz'))
    await waitForPortFree(p2, true)
  })
})

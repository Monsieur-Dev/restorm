import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import { AddressInfo } from 'node:net'
import { encodeStompFrame, parseStompFrames } from './stomp/stompFrame'

// Same pattern as WebSocketExecutionService.httpMock.test.ts: mock the two
// Electron-facing surfaces the service touches (BrowserWindow broadcasts +
// the logger) so a real ContextService + a real local `ws` server can drive
// the service end-to-end without Electron.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return {
    ...actual,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }
})

import { stompExecutionService } from './StompExecutionService'
import { contextService } from './ContextService'

interface MockBrokerHandle {
  port: number
  /** Every frame the broker received, in arrival order (for assertions). */
  received: { command: string; headers: Record<string, string>; body: string }[]
  /** Reject the next CONNECT with an ERROR frame instead of CONNECTED. */
  rejectConnect: boolean
  /** The CONNECTED frame's `heart-beat:<sx>,<sy>` header value — mutable per
   * test so the heart-beat negotiation can be exercised with asymmetric
   * values, not just the default disabled `0,0`. */
  connectedHeartBeat: string
  close: () => Promise<void>
}

/** A minimal in-process STOMP-over-WebSocket broker: CONNECT → CONNECTED,
 * SUBSCRIBE remembers the subscription, SEND pushes a MESSAGE to every
 * subscriber of that destination, DISCONNECT closes the socket. Reuses the
 * already-unit-tested `stompFrame` codec (this test targets the SERVICE's
 * orchestration, not the codec). */
function startMockBroker(): Promise<MockBrokerHandle> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 })
    const received: MockBrokerHandle['received'] = []
    const handle: MockBrokerHandle = {
      port: 0,
      received,
      rejectConnect: false,
      connectedHeartBeat: '0,0',
      close: () => new Promise((res) => { wss.close(() => { res() }) })
    }

    wss.on('connection', (ws: WsSocket) => {
      const subscriptions = new Map<string, { destination: string }>()
      ws.on('message', (data: Buffer) => {
        for (const frame of parseStompFrames(data.toString('utf8'))) {
          received.push({ command: frame.command, headers: frame.headers, body: frame.body })
          if (frame.command === 'CONNECT') {
            if (handle.rejectConnect) {
              ws.send(encodeStompFrame({ command: 'ERROR', headers: { message: 'auth failed' }, body: 'bad credentials' }))
              ws.close()
              continue
            }
            ws.send(encodeStompFrame({ command: 'CONNECTED', headers: { version: '1.2', 'heart-beat': handle.connectedHeartBeat }, body: '' }))
          } else if (frame.command === 'SUBSCRIBE') {
            const id = frame.headers['id']
            const destination = frame.headers['destination']
            if (id && destination) subscriptions.set(id, { destination })
          } else if (frame.command === 'SEND') {
            const destination = frame.headers['destination']
            for (const [subId, sub] of subscriptions) {
              if (sub.destination === destination) {
                ws.send(encodeStompFrame({
                  command: 'MESSAGE',
                  headers: { subscription: subId, destination, 'message-id': `m-${received.length}`, ack: `m-${received.length}` },
                  body: frame.body
                }))
              }
            }
          } else if (frame.command === 'DISCONNECT') {
            ws.close()
          }
        }
      })
    })
    wss.on('listening', () => {
      handle.port = (wss.address() as AddressInfo).port
      resolve(handle)
    })
  })
}

/** Register a STOMP request against the REAL ContextService the same way
 * `StompRequestTabView` does (registerRequest + updateFullRequestData), so
 * `StompExecutionService.resolveExecution` resolves everything the same way
 * production does. */
function registerStompRequest(requestId: string, input: {
  url: string
  stompVersion?: '1.1' | '1.2'
  subscriptions?: { id: string; destination: string; ackMode?: string }[]
  sendDestination?: string
  sendBody?: string
  connectHeaders?: { key: string; value: unknown; enabled?: boolean }[]
  sendHeaders?: { key: string; value: unknown; enabled?: boolean }[]
}): void {
  contextService.registerRequest(requestId, null, { id: requestId, headers: [] })
  contextService.updateFullRequestData(requestId, {
    id: requestId,
    requestType: 'stomp',
    url: input.url,
    headers: [],
    stompVersion: input.stompVersion ?? '1.2',
    connectHeaders: input.connectHeaders ?? [],
    subscriptions: input.subscriptions ?? [],
    sendDestination: input.sendDestination ?? '',
    sendBody: input.sendBody ?? '',
    sendHeaders: input.sendHeaders ?? []
  })
}

describe('StompExecutionService', () => {
  let broker: MockBrokerHandle

  beforeEach(async () => {
    broker = await startMockBroker()
  })
  afterEach(async () => {
    stompExecutionService.closeAll()
    await broker.close()
  })

  it('performs the CONNECT/CONNECTED handshake and reports success + connected', async () => {
    const requestId = 'stomp-connect-1'
    registerStompRequest(requestId, { url: `ws://127.0.0.1:${broker.port}` })

    const result = await stompExecutionService.execute({ requestId, timeout: 2000 })

    expect(result.success).toBe(true)
    expect(result.connected).toBe(true)
    expect(broker.received[0]?.command).toBe('CONNECT')
    expect(broker.received[0]?.headers['accept-version']).toBe('1.2')
    const connectedMsg = result.messages.find((m) => m.command === 'CONNECTED')
    expect(connectedMsg).toBeDefined()
    expect(connectedMsg?.direction).toBe('received')

    contextService.unregisterRequest(requestId)
  })

  it('reports failure + connected: false when the broker rejects CONNECT with ERROR', async () => {
    broker.rejectConnect = true
    const requestId = 'stomp-connect-error'
    registerStompRequest(requestId, { url: `ws://127.0.0.1:${broker.port}` })

    const result = await stompExecutionService.execute({ requestId, timeout: 2000 })

    expect(result.success).toBe(false)
    expect(result.connected).toBe(false)
    expect(result.error).toBeDefined()
    const errorMsg = result.messages.find((m) => m.command === 'ERROR')
    expect(errorMsg?.body).toBe('bad credentials')

    contextService.unregisterRequest(requestId)
  })

  it('SUBSCRIBEs right after CONNECTED and delivers a MESSAGE for a published SEND', async () => {
    const requestId = 'stomp-subscribe-message'
    registerStompRequest(requestId, {
      url: `ws://127.0.0.1:${broker.port}`,
      subscriptions: [{ id: 'sub-0', destination: '/topic/test', ackMode: 'auto' }],
      sendDestination: '/topic/test',
      sendBody: '{"hello":"world"}'
    })

    const result = await stompExecutionService.execute({ requestId, timeout: 2000 })

    expect(result.connected).toBe(true)
    const subscribeFrame = broker.received.find((f) => f.command === 'SUBSCRIBE')
    expect(subscribeFrame?.headers['destination']).toBe('/topic/test')
    expect(subscribeFrame?.headers['id']).toBe('sub-0')

    const sentFrame = result.messages.find((m) => m.direction === 'sent' && m.command === 'SEND')
    expect(sentFrame?.destination).toBe('/topic/test')
    expect(sentFrame?.body).toBe('{"hello":"world"}')

    const receivedMessage = result.messages.find((m) => m.direction === 'received' && m.command === 'MESSAGE')
    expect(receivedMessage?.subscription).toBe('sub-0')
    expect(receivedMessage?.destination).toBe('/topic/test')
    expect(receivedMessage?.body).toBe('{"hello":"world"}')

    contextService.unregisterRequest(requestId)
  })

  it('resolves a Handlebars header KEY on the CONNECT and SEND frames, not just the value', async () => {
    // A frame header NAME has no ValueType to gate on, so — like the
    // destination and the URL — the substitution is unconditional. Left
    // unresolved, `{{…}}` reaches the broker as the literal header token.
    const requestId = 'stomp-header-key-resolution'
    registerStompRequest(requestId, {
      url: `ws://127.0.0.1:${broker.port}`,
      connectHeaders: [{ key: '{{connectHeaderName}}', value: 'connect-value', enabled: true }],
      subscriptions: [{ id: 'sub-0', destination: '/topic/keys', ackMode: 'auto' }],
      sendDestination: '/topic/keys',
      sendBody: 'payload',
      sendHeaders: [{ key: '{{sendHeaderName}}', value: 'send-value', enabled: true }]
    })
    contextService.setScenarioVariables(requestId, {
      connectHeaderName: 'x-tenant',
      sendHeaderName: 'x-trace'
    })

    const result = await stompExecutionService.execute({ requestId, timeout: 2000 })

    expect(result.connected).toBe(true)
    const connectFrame = broker.received.find((f) => f.command === 'CONNECT')
    expect(connectFrame?.headers['x-tenant']).toBe('connect-value')
    expect(connectFrame?.headers).not.toHaveProperty('{{connectHeaderName}}')

    const sendFrame = broker.received.find((f) => f.command === 'SEND')
    expect(sendFrame?.headers['x-trace']).toBe('send-value')
    expect(sendFrame?.headers).not.toHaveProperty('{{sendHeaderName}}')

    contextService.unregisterRequest(requestId)
  })

  it('send() publishes a SEND frame on an already-open connection (scenario stompSend path)', async () => {
    const requestId = 'stomp-send-live'
    registerStompRequest(requestId, {
      url: `ws://127.0.0.1:${broker.port}`,
      subscriptions: [{ id: 'sub-0', destination: '/topic/live', ackMode: 'auto' }]
    })

    const connected = await new Promise<boolean>((resolve) => {
      stompExecutionService.connectStreamingStomp({
        requestId,
        onConnect: () => { resolve(true) },
        onMessage: () => { /* not asserted here */ },
        onClose: () => { /* no-op */ }
      })
    })
    expect(connected).toBe(true)
    expect(stompExecutionService.isActive(requestId)).toBe(true)

    const sendOk = stompExecutionService.send(requestId, '{"live":true}', '/topic/live')
    expect(sendOk).toBe(true)

    // Wait for the broker to echo the MESSAGE back and the service to record it.
    await new Promise((r) => setTimeout(r, 100))
    const messages = stompExecutionService.getMessages(requestId)
    expect(messages?.frames.some((m) => m.direction === 'received' && m.command === 'MESSAGE' && m.body === '{"live":true}')).toBe(true)

    stompExecutionService.disconnect(requestId)
    await new Promise((r) => setTimeout(r, 50))
    contextService.unregisterRequest(requestId)
  })

  it('ack() and nack() send ACK/NACK frames with the message + subscription ids', async () => {
    const requestId = 'stomp-ack-nack'
    registerStompRequest(requestId, {
      url: `ws://127.0.0.1:${broker.port}`,
      subscriptions: [{ id: 'sub-0', destination: '/topic/ack', ackMode: 'client' }]
    })

    await new Promise<void>((resolve) => {
      stompExecutionService.connectStreamingStomp({
        requestId,
        onConnect: () => { resolve() },
        onMessage: () => { /* no-op */ },
        onClose: () => { /* no-op */ }
      })
    })

    const ackOk = stompExecutionService.ack(requestId, 'm-42', 'sub-0')
    const nackOk = stompExecutionService.nack(requestId, 'm-43', 'sub-0')
    expect(ackOk).toBe(true)
    expect(nackOk).toBe(true)

    await new Promise((r) => setTimeout(r, 50))
    const ackFrame = broker.received.find((f) => f.command === 'ACK')
    const nackFrame = broker.received.find((f) => f.command === 'NACK')
    expect(ackFrame?.headers['id']).toBe('m-42')
    expect(ackFrame?.headers['subscription']).toBe('sub-0')
    expect(nackFrame?.headers['id']).toBe('m-43')
    expect(nackFrame?.headers['subscription']).toBe('sub-0')

    stompExecutionService.disconnect(requestId)
    await new Promise((r) => setTimeout(r, 50))
    contextService.unregisterRequest(requestId)
  })

  it('disconnect() sends DISCONNECT then closes the socket', async () => {
    const requestId = 'stomp-disconnect'
    registerStompRequest(requestId, { url: `ws://127.0.0.1:${broker.port}` })

    await new Promise<void>((resolve) => {
      stompExecutionService.connectStreamingStomp({
        requestId,
        onConnect: () => { resolve() },
        onMessage: () => { /* no-op */ },
        onClose: () => { /* no-op */ }
      })
    })
    expect(stompExecutionService.isActive(requestId)).toBe(true)

    const ok = stompExecutionService.disconnect(requestId)
    expect(ok).toBe(true)

    await new Promise((r) => setTimeout(r, 50))
    expect(broker.received.some((f) => f.command === 'DISCONNECT')).toBe(true)
    expect(stompExecutionService.isActive(requestId)).toBe(false)

    contextService.unregisterRequest(requestId)
  })

  it('arms the outgoing heart-beat timer from the CONNECTED header\'s `sy` (what the broker wants to receive), not `sx` (the broker\'s own send guarantee)', async () => {
    // Asymmetric on purpose: sx (50000) and sy (20000) are far enough apart
    // that using the wrong one produces a clearly different interval — this
    // is the exact broker shape (`sx` >> `sy`) that under `outgoingMs =
    // max(10000, sx)` would send heartbeats far too rarely and risk a
    // broker-side disconnect.
    broker.connectedHeartBeat = '50000,20000'
    const requestId = 'stomp-heartbeat-asymmetric'
    registerStompRequest(requestId, { url: `ws://127.0.0.1:${broker.port}` })

    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    await new Promise<void>((resolve) => {
      stompExecutionService.connectStreamingStomp({
        requestId,
        onConnect: () => { resolve() },
        onMessage: () => { /* no-op */ },
        onClose: () => { /* no-op */ }
      })
    })

    // Spec: outgoing interval = max(our own cx=10000, the broker's sy=20000) = 20000.
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 20000)

    setIntervalSpy.mockRestore()
    stompExecutionService.disconnect(requestId)
    await new Promise((r) => setTimeout(r, 50))
    contextService.unregisterRequest(requestId)
  })

  it('does not arm a heart-beat timer when the broker asks for none (sy = 0)', async () => {
    broker.connectedHeartBeat = '50000,0'
    const requestId = 'stomp-heartbeat-none'
    registerStompRequest(requestId, { url: `ws://127.0.0.1:${broker.port}` })

    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    await new Promise<void>((resolve) => {
      stompExecutionService.connectStreamingStomp({
        requestId,
        onConnect: () => { resolve() },
        onMessage: () => { /* no-op */ },
        onClose: () => { /* no-op */ }
      })
    })

    expect(setIntervalSpy).not.toHaveBeenCalled()

    setIntervalSpy.mockRestore()
    stompExecutionService.disconnect(requestId)
    await new Promise((r) => setTimeout(r, 50))
    contextService.unregisterRequest(requestId)
  })

  it('disconnect() clears the outgoing heart-beat timer synchronously', async () => {
    // The timer's other teardown site is the socket's `close` callback, which
    // needs another turn of the event loop. On the app-quit path that turn
    // never comes, so a still-armed interval outlives the disconnect that was
    // supposed to end the connection.
    broker.connectedHeartBeat = '30000,20000'
    const requestId = 'stomp-heartbeat-cleared-on-disconnect'
    registerStompRequest(requestId, { url: `ws://127.0.0.1:${broker.port}` })

    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    await new Promise<void>((resolve) => {
      stompExecutionService.connectStreamingStomp({
        requestId,
        onConnect: () => { resolve() },
        onMessage: () => { /* no-op */ },
        onClose: () => { /* no-op */ }
      })
    })

    const heartbeatIndex = setIntervalSpy.mock.calls.findIndex((args) => args[1] === 20000)
    expect(heartbeatIndex).toBeGreaterThanOrEqual(0)
    const heartbeatTimer: unknown = setIntervalSpy.mock.results[heartbeatIndex]?.value
    expect(heartbeatTimer).toBeDefined()
    setIntervalSpy.mockRestore()

    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    stompExecutionService.disconnect(requestId)
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatTimer)
    clearIntervalSpy.mockRestore()

    await new Promise((r) => setTimeout(r, 50))
    contextService.unregisterRequest(requestId)
  })
})

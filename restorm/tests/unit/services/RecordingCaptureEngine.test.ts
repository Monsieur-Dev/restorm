import { describe, it, expect } from 'vitest'
import { RecordingCaptureEngine, type DebuggerLike, type WebContentsLike } from '../../../src/main/services/recording/RecordingCaptureEngine'
import { RecordingCaptureStore } from '../../../src/main/services/recording/RecordingCaptureStore'
import type { RecordingFilterConfig } from '../../../src/shared/types/recordingCapture'

const ALL: RecordingFilterConfig = { protocols: ['http', 'websocket', 'graphql', 'grpc-web'], whitelist: [], blacklist: [] }

type MessageListener = (event: unknown, method: string, params: unknown) => void
type DetachListener = (event: unknown, reason: string) => void

/** A fake `webContents.debugger` that records commands and replays CDP events. */
class FakeDebugger implements DebuggerLike {
  attached = false
  commands: { method: string; params?: Record<string, unknown> }[] = []
  bodies = new Map<string, { body: string; base64Encoded: boolean }>()
  postData = new Map<string, string>()
  private messageListeners = new Set<MessageListener>()
  private detachListeners = new Set<DetachListener>()
  isAttached(): boolean { return this.attached }
  attach(): void { this.attached = true }
  detach(): void { this.attached = false }
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.commands.push({ method, ...(params ? { params } : {}) })
    const requestId = typeof params?.['requestId'] === 'string' ? params['requestId'] : ''
    if (method === 'Network.getResponseBody') {
      const body = this.bodies.get(requestId)
      return body ? Promise.resolve(body) : Promise.reject(new Error('No resource with given identifier found'))
    }
    if (method === 'Network.getRequestPostData') {
      const data = this.postData.get(requestId)
      return data === undefined ? Promise.reject(new Error('No post data available for the request')) : Promise.resolve({ postData: data })
    }
    return Promise.resolve({})
  }
  on(event: 'message' | 'detach', listener: MessageListener | DetachListener): void {
    if (event === 'message') this.messageListeners.add(listener as MessageListener)
    else this.detachListeners.add(listener as DetachListener)
  }
  removeListener(event: 'message' | 'detach', listener: MessageListener | DetachListener): void {
    if (event === 'message') this.messageListeners.delete(listener as MessageListener)
    else this.detachListeners.delete(listener as DetachListener)
  }
  emit(method: string, params: Record<string, unknown>): void {
    for (const l of this.messageListeners) l({}, method, params)
  }
  fireDetach(reason: string): void {
    for (const l of this.detachListeners) l({}, reason)
  }
  listenerCount(): number { return this.messageListeners.size + this.detachListeners.size }
}

function fakeWebContents(): { wc: WebContentsLike; dbg: FakeDebugger; destroy: () => void } {
  const dbg = new FakeDebugger()
  const destroyed = new Set<() => void>()
  let isDestroyed = false
  const wc: WebContentsLike = {
    id: 42,
    debugger: dbg,
    isDestroyed: () => isDestroyed,
    once: (_e, l) => { destroyed.add(l) },
    removeListener: (_e, l) => { destroyed.delete(l) }
  }
  return { wc, dbg, destroy: () => { isDestroyed = true; for (const l of destroyed) l() } }
}

const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

function httpExchange(dbg: FakeDebugger, requestId: string, opts: { url: string; method?: string; type?: string; status?: number; mime?: string; requestHeaders?: Record<string, string>; postData?: string; responseHeaders?: Record<string, string>; body?: string; base64?: boolean; wallTime?: number }): void {
  dbg.emit('Network.requestWillBeSent', {
    requestId,
    request: { url: opts.url, method: opts.method ?? 'GET', headers: opts.requestHeaders ?? { Accept: 'application/json' }, ...(opts.postData !== undefined ? { postData: opts.postData, hasPostData: true } : {}) },
    timestamp: 100.0,
    wallTime: opts.wallTime ?? 1_700_000_000,
    type: opts.type ?? 'Fetch'
  })
  dbg.emit('Network.requestWillBeSentExtraInfo', { requestId, headers: { cookie: 'sid=1' } })
  dbg.emit('Network.responseReceived', {
    requestId,
    type: opts.type ?? 'Fetch',
    response: { url: opts.url, status: opts.status ?? 200, statusText: 'OK', headers: opts.responseHeaders ?? { 'content-type': opts.mime ?? 'application/json' }, mimeType: opts.mime ?? 'application/json' }
  })
  dbg.emit('Network.responseReceivedExtraInfo', { requestId, headers: { 'set-cookie': 'a=b' } })
  if (opts.body !== undefined) dbg.bodies.set(requestId, { body: opts.body, base64Encoded: opts.base64 ?? false })
  dbg.emit('Network.loadingFinished', { requestId, timestamp: 100.25, encodedDataLength: 512 })
}

async function startEngine(config: RecordingFilterConfig = ALL): Promise<{ engine: RecordingCaptureEngine; store: RecordingCaptureStore; dbg: FakeDebugger; destroy: () => void }> {
  const store = new RecordingCaptureStore()
  const engine = new RecordingCaptureEngine(store)
  const { wc, dbg, destroy } = fakeWebContents()
  await engine.start('s1', 'tab-1', wc, 'http://localhost:8080/', config)
  return { engine, store, dbg, destroy }
}

describe('recording capture engine — attach / detach', () => {
  it('attaches the debugger, enables Network, and opens a run', async () => {
    const { engine, store, dbg } = await startEngine()
    expect(dbg.attached).toBe(true)
    expect(dbg.commands[0]?.method).toBe('Network.enable')
    expect(store.status('s1')).toMatchObject({ state: 'recording', tabId: 'tab-1' })
    expect(engine.isRecording('s1')).toBe(true)
    expect(engine.sessionForTab('tab-1')).toBe('s1')
    engine.stop('s1')
    expect(dbg.attached).toBe(false)
    expect(dbg.listenerCount()).toBe(0)
    expect(store.status('s1').state).toBe('idle')
    expect(engine.sessionForTab('tab-1')).toBeNull()
  })

  it('a debugger detach (devtools, crash) or a destroyed web contents ends the run', async () => {
    const a = await startEngine()
    a.dbg.fireDetach('target closed')
    expect(a.engine.isRecording('s1')).toBe(false)
    expect(a.store.status('s1').state).toBe('idle')
    const b = await startEngine()
    b.destroy()
    expect(b.engine.isRecording('s1')).toBe(false)
    expect(b.store.status('s1').state).toBe('idle')
  })

  it('pause keeps listening but stores nothing; resume stores again', async () => {
    const { engine, store, dbg } = await startEngine()
    engine.pause('s1')
    httpExchange(dbg, 'r1', { url: 'http://localhost:8080/api/paused', body: '{}' })
    await flush()
    expect(store.list('s1')).toHaveLength(0)
    engine.resume('s1')
    httpExchange(dbg, 'r2', { url: 'http://localhost:8080/api/resumed', body: '{}' })
    await flush()
    expect(store.list('s1').map((c) => c.url)).toEqual(['http://localhost:8080/api/resumed'])
  })
})

describe('recording capture engine — HTTP exchanges', () => {
  it('folds request, response, raw headers, body and timing into one call', async () => {
    const { store, dbg } = await startEngine()
    httpExchange(dbg, 'r1', { url: 'http://localhost:8080/api/swagger.json?v=2', body: '{"openapi":"3.0.0"}' })
    await flush()
    const [row] = store.list('s1')
    expect(row).toMatchObject({ protocol: 'http', method: 'GET', url: 'http://localhost:8080/api/swagger.json?v=2', status: 200, statusText: 'OK', mimeType: 'application/json', resourceType: 'fetch', durationMs: 250, responseSize: 512, timestamp: 1_700_000_000_000 })
    const detail = store.get('s1', row?.id ?? '')
    expect(detail?.request.headers).toEqual([{ key: 'Accept', value: 'application/json' }, { key: 'cookie', value: 'sid=1' }])
    expect(detail?.request.query).toEqual([{ key: 'v', value: '2' }])
    expect(detail?.response?.headers).toEqual([{ key: 'content-type', value: 'application/json' }, { key: 'set-cookie', value: 'a=b' }])
    expect(detail?.response?.body).toEqual({ encoding: 'utf8', data: '{"openapi":"3.0.0"}', mimeType: 'application/json', size: 19 })
  })

  it('fetches a large POST body on demand and classifies GraphQL', async () => {
    const { store, dbg } = await startEngine()
    dbg.postData.set('r1', JSON.stringify({ query: 'mutation AddPet { addPet { id } }' }))
    dbg.emit('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'http://localhost:8080/graphql', method: 'POST', headers: { 'content-type': 'application/json' }, hasPostData: true }, timestamp: 1, wallTime: 1, type: 'XHR' })
    dbg.emit('Network.responseReceived', { requestId: 'r1', type: 'XHR', response: { url: 'http://localhost:8080/graphql', status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json' } })
    dbg.bodies.set('r1', { body: '{"data":{}}', base64Encoded: false })
    dbg.emit('Network.loadingFinished', { requestId: 'r1', timestamp: 1.1 })
    await flush()
    const [row] = store.list('s1')
    expect(row).toMatchObject({ protocol: 'graphql', method: 'POST', graphql: { operationType: 'mutation', operationName: 'AddPet' } })
    expect(store.get('s1', row?.id ?? '')?.request.body?.data).toContain('AddPet')
    expect(dbg.commands.some((c) => c.method === 'Network.getRequestPostData')).toBe(true)
  })

  it('classifies gRPC-web and keeps binary bodies base64', async () => {
    const { store, dbg } = await startEngine()
    httpExchange(dbg, 'r1', { url: 'http://localhost:8080/pets.PetService/GetPet', method: 'POST', type: 'XHR', mime: 'application/grpc-web+proto', requestHeaders: { 'content-type': 'application/grpc-web+proto' }, postData: 'AAAA', body: 'AAAAAAI=', base64: true })
    await flush()
    const [row] = store.list('s1')
    expect(row).toMatchObject({ protocol: 'grpc-web', grpc: { service: 'pets.PetService', method: 'GetPet' } })
    expect(store.get('s1', row?.id ?? '')?.response?.body).toMatchObject({ encoding: 'base64', size: 5 })
  })

  it('skips page assets, the page navigation itself and CORS preflights at the door', async () => {
    const { store, dbg } = await startEngine()
    httpExchange(dbg, 'r1', { url: 'http://localhost:8080/app.js', type: 'Script', mime: 'text/javascript', body: 'x' })
    httpExchange(dbg, 'r2', { url: 'http://localhost:8080/logo.png', type: 'Image', mime: 'image/png', body: 'AA==', base64: true })
    httpExchange(dbg, 'r3', { url: 'http://localhost:8080/api/pets', type: 'Preflight', method: 'OPTIONS', status: 204 })
    // The page loading (the recording attaches before it does) is not an API call.
    httpExchange(dbg, 'r4', { url: 'http://localhost:8080/', type: 'Document', mime: 'text/html', body: '<html>' })
    httpExchange(dbg, 'r5', { url: 'http://localhost:8080/api/pets', type: 'XHR', body: '[]' })
    await flush()
    expect(store.list('s1').map((c) => `${c.resourceType} ${c.url}`)).toEqual(['xhr http://localhost:8080/api/pets'])
    expect(dbg.commands.filter((c) => c.method === 'Network.getResponseBody')).toHaveLength(1)
  })

  it('does not fetch bodies for urls the lists refuse', async () => {
    const { store, dbg } = await startEngine({ ...ALL, blacklist: ['swagger'] })
    httpExchange(dbg, 'r1', { url: 'http://localhost:8080/api/swagger.json', body: '{}' })
    httpExchange(dbg, 'r2', { url: 'http://localhost:8080/api/pets', body: '[]' })
    await flush()
    expect(store.list('s1').map((c) => c.url)).toEqual(['http://localhost:8080/api/pets'])
    expect(dbg.commands.filter((c) => c.method === 'Network.getResponseBody').map((c) => c.params?.['requestId'])).toEqual(['r2'])
  })

  it('stores a redirect as its own 30x call before the follow-up request', async () => {
    const { store, dbg } = await startEngine()
    dbg.emit('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'http://localhost:8080/old', method: 'GET', headers: {} }, timestamp: 1, wallTime: 1, type: 'Fetch' })
    dbg.emit('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'http://localhost:8080/new', method: 'GET', headers: {} }, timestamp: 1.05, wallTime: 1.05, type: 'Fetch', redirectResponse: { url: 'http://localhost:8080/old', status: 302, statusText: 'Found', headers: { location: '/new' }, mimeType: '' } })
    dbg.emit('Network.responseReceived', { requestId: 'r1', type: 'Fetch', response: { url: 'http://localhost:8080/new', status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json' } })
    dbg.bodies.set('r1', { body: '{}', base64Encoded: false })
    dbg.emit('Network.loadingFinished', { requestId: 'r1', timestamp: 1.2 })
    await flush()
    expect(store.list('s1').map((c) => `${c.status} ${c.url}`)).toEqual(['302 http://localhost:8080/old', '200 http://localhost:8080/new'])
    const redirect = store.get('s1', store.list('s1')[0]?.id ?? '')
    expect(redirect?.response?.headers).toEqual([{ key: 'location', value: '/new' }])
    expect(redirect?.response?.body).toBeNull()
  })

  it('records a failed request with its error and no response', async () => {
    const { store, dbg } = await startEngine()
    dbg.emit('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'http://down.test/api', method: 'GET', headers: {} }, timestamp: 1, wallTime: 1, type: 'Fetch' })
    dbg.emit('Network.loadingFailed', { requestId: 'r1', timestamp: 1.5, errorText: 'net::ERR_CONNECTION_REFUSED', canceled: false })
    await flush()
    const [row] = store.list('s1')
    expect(row).toMatchObject({ url: 'http://down.test/api', error: 'net::ERR_CONNECTION_REFUSED', durationMs: 500 })
    expect(row).not.toHaveProperty('status')
    expect(store.get('s1', row?.id ?? '')?.response).toBeNull()
  })

  it('a 204 response is stored without asking for a body', async () => {
    const { store, dbg } = await startEngine()
    httpExchange(dbg, 'r1', { url: 'http://localhost:8080/api/pets/1', method: 'DELETE', status: 204 })
    await flush()
    expect(store.list('s1')[0]).toMatchObject({ method: 'DELETE', status: 204 })
    expect(dbg.commands.some((c) => c.method === 'Network.getResponseBody')).toBe(false)
  })
})

describe('recording capture engine — WebSocket', () => {
  it('one call per connection, frames appended live, message types collected', async () => {
    const { store, dbg } = await startEngine()
    const updates: number[] = []
    store.on('capture-updated', (s) => { updates.push(s.websocket?.frameCount ?? -1) })
    dbg.emit('Network.webSocketCreated', { requestId: 'ws1', url: 'ws://localhost:8080/socket' })
    dbg.emit('Network.webSocketWillSendHandshakeRequest', { requestId: 'ws1', request: { headers: { Upgrade: 'websocket' } } })
    dbg.emit('Network.webSocketHandshakeResponseReceived', { requestId: 'ws1', response: { status: 101, statusText: 'Switching Protocols', headers: { Connection: 'Upgrade' } } })
    dbg.emit('Network.webSocketFrameSent', { requestId: 'ws1', response: { opcode: 1, payloadData: '{"type":"subscribe","topic":"pets"}' } })
    dbg.emit('Network.webSocketFrameReceived', { requestId: 'ws1', response: { opcode: 1, payloadData: '{"type":"pet.created","id":1}' } })
    dbg.emit('Network.webSocketFrameReceived', { requestId: 'ws1', response: { opcode: 2, payloadData: 'AQID' } })
    dbg.emit('Network.webSocketClosed', { requestId: 'ws1' })
    const [row] = store.list('s1')
    expect(row).toMatchObject({ protocol: 'websocket', method: 'WS', url: 'ws://localhost:8080/socket', status: 101, websocket: { messageType: 'subscribe', messageTypes: ['subscribe', 'pet.created'], frameCount: 3, closed: true } })
    const detail = store.get('s1', row?.id ?? '')
    expect(detail?.request.headers).toEqual([{ key: 'Upgrade', value: 'websocket' }])
    expect(detail?.websocketFrames?.map((f) => `${f.direction}:${f.opcode}`)).toEqual(['sent:1', 'received:1', 'received:2'])
    expect(updates).toEqual([0, 0, 1, 2, 3, 3])
  })

  it('a socket the lists refuse (or a disabled protocol) is never tracked', async () => {
    const { store, dbg } = await startEngine({ ...ALL, protocols: ['http'] })
    dbg.emit('Network.webSocketCreated', { requestId: 'ws1', url: 'ws://localhost:8080/socket' })
    dbg.emit('Network.webSocketFrameSent', { requestId: 'ws1', response: { opcode: 1, payloadData: '{}' } })
    expect(store.list('s1')).toEqual([])
  })
})

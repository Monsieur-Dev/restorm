import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'

// The HTTP-mock route lifecycle lives on the shared PortHost in
// WebSocketExecutionService. Mock the two Electron-facing surfaces the service
// touches (BrowserWindow broadcasts + the logger) so the registry + the
// `request` dispatcher can be exercised with real sockets, no Electron.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
// Partial mock: keep every real ECUI/main export (createPubSub etc. are pulled
// in transitively via ContextService → CollectionStore) and only silence the
// logger so the test output stays clean.
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return {
    ...actual,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }
})

import { websocketExecutionService } from './WebSocketExecutionService'

/** Fire a GET against 127.0.0.1:<port><path> and resolve its status + body. */
function httpGet(port: number, path: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }) })
    })
    req.on('error', reject)
    req.end()
  })
}

/** A free ephemeral port (bind :0, read it back, release). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port
      srv.close(() => { resolve(port) })
    })
  })
}

/** True when nothing is listening on 127.0.0.1:<port> (i.e. the mock freed it). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 300 }, (res) => {
      res.resume()
      resolve(false) // something answered → still bound
    })
    probe.on('error', (err: NodeJS.ErrnoException) => { resolve(err.code === 'ECONNREFUSED') })
    probe.on('timeout', () => { probe.destroy(); resolve(false) })
    probe.end()
  })
}

describe('WebSocketExecutionService — HTTP mock route dispatcher', () => {
  beforeEach(async () => {
    await websocketExecutionService.closeAll()
  })
  afterEach(async () => {
    await websocketExecutionService.closeAll()
  })

  it('matches a registered METHOD + PATH and runs its handler', async () => {
    const port = await freePort()
    const r = await websocketExecutionService.listenHttpServer({
      requestId: 'mock-1',
      method: 'GET',
      port,
      path: '/pets',
      onRequest: (_req, res) => { res.writeHead(201, { 'X-Test': 'yes' }); res.end('{"ok":true}') },
      onStopped: () => undefined
    })
    expect(r.listening).toBe(true)

    const resp = await httpGet(port, '/pets')
    expect(resp.status).toBe(201)
    expect(resp.body).toBe('{"ok":true}')
    expect(resp.headers['x-test']).toBe('yes')

    websocketExecutionService.disconnect('mock-1')
  })

  it('404s an unregistered path on a port that has a mock route', async () => {
    const port = await freePort()
    await websocketExecutionService.listenHttpServer({
      requestId: 'mock-2',
      method: 'GET',
      port,
      path: '/pets',
      onRequest: (_req, res) => { res.writeHead(200); res.end('pets') },
      onStopped: () => undefined
    })

    const resp = await httpGet(port, '/unknown')
    expect(resp.status).toBe(404)

    // Method mismatch on a known path also 404s (route key is METHOD + PATH).
    const post = await new Promise<number>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/pets', method: 'POST' }, (res) => {
        res.resume(); resolve(res.statusCode ?? 0)
      })
      req.on('error', reject); req.end()
    })
    expect(post).toBe(404)

    websocketExecutionService.disconnect('mock-2')
  })

  it('rejects a duplicate METHOD + PATH on the same port (collision)', async () => {
    const port = await freePort()
    const first = await websocketExecutionService.listenHttpServer({
      requestId: 'mock-3a',
      method: 'GET',
      port,
      path: '/pets',
      onRequest: (_req, res) => { res.end('a') },
      onStopped: () => undefined
    })
    expect(first.listening).toBe(true)

    const second = await websocketExecutionService.listenHttpServer({
      requestId: 'mock-3b',
      method: 'GET',
      port,
      path: '/pets',
      onRequest: (_req, res) => { res.end('b') },
      onStopped: () => undefined
    })
    expect(second.listening).toBe(false)
    expect(second.error).toContain('already listening')

    // A different path on the same port is NOT a collision.
    const third = await websocketExecutionService.listenHttpServer({
      requestId: 'mock-3c',
      method: 'GET',
      port,
      path: '/owners',
      onRequest: (_req, res) => { res.end('c') },
      onStopped: () => undefined
    })
    expect(third.listening).toBe(true)

    websocketExecutionService.disconnect('mock-3a')
    websocketExecutionService.disconnect('mock-3c')
  })

  it('frees the port only when the last route on it stops', async () => {
    const port = await freePort()
    await websocketExecutionService.listenHttpServer({
      requestId: 'mock-4a', method: 'GET', port, path: '/a', onRequest: (_q, res) => { res.end('a') }, onStopped: () => undefined
    })
    await websocketExecutionService.listenHttpServer({
      requestId: 'mock-4b', method: 'GET', port, path: '/b', onRequest: (_q, res) => { res.end('b') }, onStopped: () => undefined
    })

    // Stop the first: the port stays bound (the second route still holds it).
    websocketExecutionService.disconnect('mock-4a')
    expect(await isPortFree(port)).toBe(false)
    expect((await httpGet(port, '/b')).body).toBe('b')

    // Stop the last: the port frees.
    websocketExecutionService.disconnect('mock-4b')
    // Give the OS a tick to release the socket.
    await new Promise((r) => setTimeout(r, 50))
    expect(await isPortFree(port)).toBe(true)
  })
})

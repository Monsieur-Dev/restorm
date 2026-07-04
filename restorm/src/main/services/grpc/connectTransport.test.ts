// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeConnectUnary, executeConnectStream, connectStatusFromError } from './connectTransport'
import { encodeConnectEnvelope } from './connectCodec'

/** Spin up a plain HTTP server that answers per the Connect protocol (JSON
 * unary or enveloped streaming), so the transport is verified end-to-end
 * without a real Connect-RPC server. */
function startMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ port, close: () => new Promise((r) => { server.close(() => { r() }) }) })
    })
  })
}

function endStreamEnvelope(json: string): Buffer {
  const payload = Buffer.from(json)
  const header = Buffer.alloc(5)
  header.writeUInt8(0x02, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

describe('executeConnectUnary', () => {
  it('posts the unenveloped JSON body to the exact path with unary headers, and unwraps a success response', async () => {
    let receivedPath: string | undefined
    let receivedHeaders: http.IncomingHttpHeaders | undefined
    let receivedBody = ''

    const server = await startMockServer((req, res) => {
      receivedPath = req.url
      receivedHeaders = req.headers
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString('utf8')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ f_string: 'hello Connect' }))
      })
    })
    close = server.close

    const result = await executeConnectUnary({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/grpcbin.GRPCBin/DummyUnary',
      headers: { 'x-custom': 'abc' },
      body: JSON.stringify({ f_string: 'hi' }),
      timeoutMs: 5000
    })

    expect(receivedPath).toBe('/grpcbin.GRPCBin/DummyUnary')
    expect(receivedHeaders?.['content-type']).toBe('application/json')
    expect(receivedHeaders?.['connect-protocol-version']).toBe('1')
    expect(receivedHeaders?.['x-custom']).toBe('abc')
    expect(receivedBody).toBe(JSON.stringify({ f_string: 'hi' }))

    expect(result).toEqual({ ok: true, message: { f_string: 'hello Connect' } })
  })

  it('unwraps a Connect error response ({ code, message } body on a non-2xx status)', async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 'not_found', message: 'no such method' }))
    })
    close = server.close

    const result = await executeConnectUnary({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/missing.Service/Method',
      headers: {},
      body: '{}',
      timeoutMs: 5000
    })

    expect(result).toEqual({ ok: false, error: { code: 'not_found', message: 'no such method' } })
  })

  it('falls back to the HTTP status text when an error response has no JSON body', async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(500, 'Internal Server Error')
      res.end()
    })
    close = server.close

    const result = await executeConnectUnary({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/x.Y/Z',
      headers: {},
      body: '{}',
      timeoutMs: 5000
    })

    expect(result.ok).toBe(false)
    expect(result.error).toEqual({ code: 'unknown', message: 'Internal Server Error' })
  })

  it('rejects when the server never responds within the timeout', async () => {
    const server = await startMockServer(() => {
      // never respond
    })
    close = server.close

    await expect(executeConnectUnary({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/x.Y/Z',
      headers: {},
      body: '{}',
      timeoutMs: 50
    })).rejects.toThrow(/timed out/)
  })
})

describe('executeConnectStream', () => {
  it('posts one enveloped request message with streaming headers, and delivers DATA envelopes incrementally before the END-STREAM envelope', async () => {
    let receivedHeaders: http.IncomingHttpHeaders | undefined
    let receivedBody = Buffer.alloc(0)

    const server = await startMockServer((req, res) => {
      receivedHeaders = req.headers
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks)
        res.writeHead(200)
        res.write(encodeConnectEnvelope(Buffer.from(JSON.stringify({ f_string: 'frame-1' }))))
        res.write(encodeConnectEnvelope(Buffer.from(JSON.stringify({ f_string: 'frame-2' }))))
        res.end(endStreamEnvelope('{}'))
      })
    })
    close = server.close

    const received: unknown[] = []
    const result = await executeConnectStream({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/grpcbin.GRPCBin/DummyServerStream',
      headers: {},
      body: JSON.stringify({ f_string: 'req' }),
      timeoutMs: 5000,
      onMessage: (payload) => { received.push(payload) }
    })

    expect(receivedHeaders?.['content-type']).toBe('application/connect+json')
    expect(receivedBody.subarray(5).toString()).toBe(JSON.stringify({ f_string: 'req' }))
    expect(received).toEqual([{ f_string: 'frame-1' }, { f_string: 'frame-2' }])
    expect(result).toEqual({})
  })

  it('surfaces the error carried by the END-STREAM envelope', async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(200)
      res.end(endStreamEnvelope(JSON.stringify({ error: { code: 'unavailable', message: 'down' } })))
    })
    close = server.close

    const result = await executeConnectStream({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/x.Y/Z',
      headers: {},
      body: '{}',
      timeoutMs: 5000,
      onMessage: () => { /* not exercised by this test */ }
    })

    expect(result).toEqual({ error: { code: 'unavailable', message: 'down' } })
  })
})

describe('connectStatusFromError', () => {
  it('resolves to OK when there is no error', () => {
    expect(connectStatusFromError(undefined)).toEqual({ statusCode: 0, statusMessage: 'OK' })
  })

  it('maps a known Connect code to its gRPC numeric status', () => {
    const status = connectStatusFromError({ code: 'not_found', message: 'nope' })
    expect(status).toEqual({ statusCode: 5, statusMessage: 'nope' })
  })

  it('falls back to UNKNOWN for an unrecognised code', () => {
    const status = connectStatusFromError({ code: 'totally_made_up', message: 'huh' })
    expect(status.statusCode).toBe(2)
  })
})

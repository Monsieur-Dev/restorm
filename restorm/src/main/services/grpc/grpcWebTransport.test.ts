// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeGrpcWebRequest, grpcWebStatus, type GrpcWebResponse } from './grpcWebTransport'
import { encodeGrpcWebFrame } from './grpcWebCodec'

/** Spin up a plain HTTP server that answers with a hand-framed gRPC-Web body,
 * so the transport is verified end-to-end without a real gRPC-Web server. */
function startMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ port, close: () => new Promise((r) => { server.close(() => { r() }) }) })
    })
  })
}

function trailerFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(5)
  header.writeUInt8(0x80, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

describe('executeGrpcWebRequest', () => {
  it('posts the framed body to the exact gRPC path with grpc-web headers, and decodes a single DATA frame + trailers', async () => {
    let receivedPath: string | undefined
    let receivedHeaders: http.IncomingHttpHeaders | undefined
    let receivedBody = Buffer.alloc(0)

    const server = await startMockServer((req, res) => {
      receivedPath = req.url
      receivedHeaders = req.headers
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks)
        res.writeHead(200, { 'content-type': 'application/grpc-web+proto' })
        res.write(encodeGrpcWebFrame(Buffer.from('response-payload')))
        res.end(trailerFrame('grpc-status: 0\r\ngrpc-message: OK\r\n'))
      })
    })
    close = server.close

    const received: Buffer[] = []
    const result = await executeGrpcWebRequest({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/grpcbin.GRPCBin/DummyUnary',
      headers: { 'x-custom': 'abc' },
      body: encodeGrpcWebFrame(Buffer.from('request-payload')),
      timeoutMs: 5000,
      onData: (payload) => { received.push(payload) }
    })

    expect(receivedPath).toBe('/grpcbin.GRPCBin/DummyUnary')
    expect(receivedHeaders?.['content-type']).toBe('application/grpc-web+proto')
    expect(receivedHeaders?.['x-grpc-web']).toBe('1')
    expect(receivedHeaders?.['x-custom']).toBe('abc')
    expect(receivedBody.subarray(5).toString()).toBe('request-payload')

    expect(received).toHaveLength(1)
    expect(received[0]?.toString()).toBe('response-payload')
    expect(result.httpStatus).toBe(200)
    expect(result.trailers).toEqual({ 'grpc-status': '0', 'grpc-message': 'OK' })
  })

  it('delivers multiple DATA frames incrementally (server-streaming) before the final trailer', async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(200)
      res.write(encodeGrpcWebFrame(Buffer.from('frame-1')))
      res.write(encodeGrpcWebFrame(Buffer.from('frame-2')))
      res.end(trailerFrame('grpc-status: 0\r\n'))
    })
    close = server.close

    const received: string[] = []
    const result = await executeGrpcWebRequest({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/grpcbin.GRPCBin/DummyServerStream',
      headers: {},
      body: encodeGrpcWebFrame(Buffer.from('req')),
      timeoutMs: 5000,
      onData: (payload) => { received.push(payload.toString()) }
    })

    expect(received).toEqual(['frame-1', 'frame-2'])
    expect(result.trailers['grpc-status']).toBe('0')
  })

  it('surfaces a grpc-status sent as a real HTTP header (no body at all)', async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(404, { 'grpc-status': '5', 'grpc-message': 'not found' })
      res.end()
    })
    close = server.close

    const result = await executeGrpcWebRequest({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/missing.Service/Method',
      headers: {},
      body: encodeGrpcWebFrame(Buffer.from('req')),
      timeoutMs: 5000,
      onData: () => { /* not exercised by this test */ }
    })

    expect(result.httpStatus).toBe(404)
    expect(result.headers['grpc-status']).toBe('5')
    expect(result.headers['grpc-message']).toBe('not found')
    expect(result.trailers).toEqual({})
  })

  it('rejects when the server never responds within the timeout', async () => {
    const server = await startMockServer(() => {
      // never respond
    })
    close = server.close

    await expect(executeGrpcWebRequest({
      address: `127.0.0.1:${server.port}`,
      secure: false,
      path: '/x.Y/Z',
      headers: {},
      body: encodeGrpcWebFrame(Buffer.alloc(0)),
      timeoutMs: 50,
      onData: () => { /* not exercised by this test */ }
    })).rejects.toThrow(/timed out/)
  })
})

describe('grpcWebStatus', () => {
  const base: GrpcWebResponse = { httpStatus: 200, httpStatusMessage: 'OK', headers: {}, trailers: {} }

  it('reads status + message from the trailer frame', () => {
    const status = grpcWebStatus({ ...base, trailers: { 'grpc-status': '0', 'grpc-message': 'OK' } })
    expect(status).toEqual({ statusCode: 0, statusMessage: 'OK' })
  })

  it('decodes a percent-encoded grpc-message', () => {
    const status = grpcWebStatus({ ...base, trailers: { 'grpc-status': '5', 'grpc-message': 'not%20found%3A%20foo' } })
    expect(status).toEqual({ statusCode: 5, statusMessage: 'not found: foo' })
  })

  it('falls back to a response header when there is no trailer frame', () => {
    const status = grpcWebStatus({ ...base, httpStatus: 404, headers: { 'grpc-status': '5', 'grpc-message': 'not found' } })
    expect(status).toEqual({ statusCode: 5, statusMessage: 'not found' })
  })

  it('falls back to the gRPC status NAME when grpc-message is absent', () => {
    const status = grpcWebStatus({ ...base, trailers: { 'grpc-status': '0' } })
    expect(status.statusMessage).toBe('OK')
  })

  it('defaults to OK when the HTTP call succeeded and carried no status at all', () => {
    const status = grpcWebStatus({ ...base, httpStatus: 200 })
    expect(status).toEqual({ statusCode: 0, statusMessage: 'OK' })
  })

  it('defaults to UNKNOWN with the HTTP status text when nothing else is available', () => {
    const status = grpcWebStatus({ ...base, httpStatus: 502, httpStatusMessage: 'Bad Gateway' })
    expect(status).toEqual({ statusCode: 2, statusMessage: 'Bad Gateway' })
  })
})

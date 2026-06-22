import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import net from 'node:net'
import * as grpc from '@grpc/grpc-js'
import { resolveGrpcMethod } from './grpc/grpcProtoLoader'

// Mock the Electron-facing surfaces the service touches (BrowserWindow
// broadcasts + the logger), and stub the CollectionStore so `findById` returns
// the server request under test — no Electron, real sockets.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return { ...actual, logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }
})

// The mock store the service reads its bound request from.
const store = new Map<string, unknown>()
vi.mock('./CollectionStore', () => ({
  collectionStore: { findById: (id: string) => store.get(id) ?? null }
}))

import { grpcMockServerService } from './GRPCMockServerService'

const PROTO = `syntax = "proto3";
package test;
message Req { string name = 1; }
message Res { string message = 1; }
service Svc {
  rpc Unary (Req) returns (Res);
  rpc Down (Req) returns (stream Res);
}`

/** A free ephemeral TCP port (bind :0, read it back, release). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => { resolve(port) })
    })
  })
}

/** Whether nothing is listening on 127.0.0.1:<port> (the mock freed it). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => { sock.destroy(); resolve(false) })
    sock.on('error', (err: NodeJS.ErrnoException) => { resolve(err.code === 'ECONNREFUSED') })
  })
}

/** Register a server: true gRPC request in the mock store. */
function registerServer(id: string, port: number, mockMethods: unknown[]): void {
  store.set(id, {
    id, type: 'grpc', name: id, server: true, url: `localhost:${port}`,
    protoContent: PROTO, reflection: false, mockMethods
  })
}

/** Fire a unary call against the hosted mock and resolve {err, response}. */
function unaryCall(port: number, message: object): Promise<{ err: grpc.ServiceError | null; response?: object }> {
  const m = resolveGrpcMethod({ protoContent: PROTO }, `127.0.0.1:${port}`, 'test.Svc', 'Unary', grpc.credentials.createInsecure())
  return new Promise((resolve) => {
    m.client['Unary'](message, (err: grpc.ServiceError | null, response: object) => {
      resolve({ err, response })
    })
  })
}

describe('GRPCMockServerService — hosted gRPC mock (real server, real client)', () => {
  beforeEach(() => { store.clear(); grpcMockServerService.closeAll() })
  afterEach(() => { grpcMockServerService.closeAll() })

  it('serves a unary method with its canned response message', async () => {
    const port = await freePort()
    registerServer('m1', port, [{ service: 'test.Svc', method: 'Unary', callType: 'unary', responseMessage: '{"message":"hi there"}' }])
    const r = await grpcMockServerService.listen('m1')
    expect(r.listening).toBe(true)

    const { err, response } = await unaryCall(port, { name: 'x' })
    expect(err).toBeNull()
    expect(response).toMatchObject({ message: 'hi there' })

    grpcMockServerService.stopListening('m1')
  })

  it('answers a configured non-OK status with its message', async () => {
    const port = await freePort()
    registerServer('m2', port, [{ service: 'test.Svc', method: 'Unary', callType: 'unary', responseMessage: '{}', statusCode: grpc.status.NOT_FOUND, statusMessage: 'nope' }])
    await grpcMockServerService.listen('m2')

    const { err } = await unaryCall(port, { name: 'x' })
    if (!err) throw new Error('expected a non-OK status error')
    expect(err.code).toBe(grpc.status.NOT_FOUND)
    expect(err.details).toContain('nope')

    grpcMockServerService.stopListening('m2')
  })

  // The scripted (code-node) responder runs through the QuickJS/esbuild sandbox,
  // which can't initialise under the vitest worker environment ("esbuild relies
  // on this invariant" / "JavaScript environment is broken"). The script path is
  // exercised in the real app instead; the canned + status + streaming paths
  // below cover the server's wire behaviour here.

  it('serves a server-streaming method with canned frames', async () => {
    const port = await freePort()
    registerServer('m4', port, [{ service: 'test.Svc', method: 'Down', callType: 'server-stream', responseMessage: '[{"message":"a"},{"message":"b"}]' }])
    await grpcMockServerService.listen('m4')

    const m = resolveGrpcMethod({ protoContent: PROTO }, `127.0.0.1:${port}`, 'test.Svc', 'Down', grpc.credentials.createInsecure())
    const frames: object[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = m.client['Down']({ name: 'x' }) as grpc.ClientReadableStream<object>
      stream.on('data', (d: object) => { frames.push(d) })
      stream.on('end', () => { resolve() })
      stream.on('error', (e: Error) => { reject(e) })
    })
    expect(frames).toMatchObject([{ message: 'a' }, { message: 'b' }])

    grpcMockServerService.stopListening('m4')
  })

  it('frees the port on stopListening + closeAll (no leak)', async () => {
    const port = await freePort()
    registerServer('m5', port, [{ service: 'test.Svc', method: 'Unary', callType: 'unary', responseMessage: '{}' }])
    await grpcMockServerService.listen('m5')
    expect(grpcMockServerService.isListening('m5')).toBe(true)
    expect(await isPortFree(port)).toBe(false)

    grpcMockServerService.stopListening('m5')
    await new Promise((r) => setTimeout(r, 50))
    expect(grpcMockServerService.isListening('m5')).toBe(false)
    expect(await isPortFree(port)).toBe(true)
  })

  it('fails to listen when the bound request is not in server mode', async () => {
    store.set('client', { id: 'client', type: 'grpc', name: 'c', server: false, url: 'localhost:50051' })
    const r = await grpcMockServerService.listen('client')
    expect(r.listening).toBe(false)
    expect(r.error).toMatch(/server mode/)
  })
})

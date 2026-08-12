import { describe, it, expect } from 'vitest'
import { GrpcRequest } from './GrpcRequest'
import { KeyValue } from '../KeyValue'

/**
 * The gRPC mock-server config (`server`, `mockMethods`, proto source, reflection,
 * TLS) must round-trip through `toPlainObject` → `fromPlain` unchanged, so a
 * hosted mock survives a save/reload from disk. Per-method `trailers` are
 * `KeyValue` rows and must survive too.
 */
describe('GrpcRequest — mock-server persistence round-trip', () => {
  it('round-trips server + mockMethods + proto + reflection + tls', () => {
    const original = new GrpcRequest({
      id: 'r1',
      name: 'Mock',
      server: true,
      url: 'localhost:50051',
      reflection: true,
      tls: true,
      tlsCertPem: '-----CERT-----',
      tlsKeyPem: '-----KEY-----',
      protoContent: 'syntax = "proto3"; package m; message E {} service S { rpc P (E) returns (E); }',
      mockMethods: [
        {
          service: 'm.S',
          method: 'P',
          callType: 'unary',
          responseMessage: '{"ok":true}',
          statusCode: 5,
          statusMessage: 'not found',
          trailers: [KeyValue.fromPlain({ key: 'x-trace', value: 'abc', enabled: true })],
          script: 'return { ok: true }'
        }
      ]
    })

    const plain = original.toPlainObject()
    const restored = GrpcRequest.fromPlain(plain as unknown as Parameters<typeof GrpcRequest.fromPlain>[0])

    expect(restored.server).toBe(true)
    expect(restored.url).toBe('localhost:50051')
    expect(restored.reflection).toBe(true)
    expect(restored.tls).toBe(true)
    expect(restored.tlsCertPem).toBe('-----CERT-----')
    expect(restored.tlsKeyPem).toBe('-----KEY-----')
    expect(restored.protoContent).toContain('service S')
    const methods = restored.mockMethods ?? []
    expect(methods).toHaveLength(1)
    const m = methods[0]
    if (!m) throw new Error('mock method missing')
    expect(m).toMatchObject({
      service: 'm.S',
      method: 'P',
      callType: 'unary',
      responseMessage: '{"ok":true}',
      statusCode: 5,
      statusMessage: 'not found',
      script: 'return { ok: true }'
    })
    const trailers = m.trailers ?? []
    expect(trailers).toHaveLength(1)
    const trailer = trailers[0]
    if (!trailer) throw new Error('trailer missing')
    expect(trailer).toBeInstanceOf(KeyValue)
    expect(trailer.key).toBe('x-trace')
    expect(trailer.value.toString()).toBe('abc')
  })

  it('omits the mock-server fields entirely for a plain client request', () => {
    const client = new GrpcRequest({ id: 'c1', name: 'Client', url: 'localhost:9000', service: 's', method: 'M', callType: 'unary' })
    const plain = client.toPlainObject()
    expect('server' in plain).toBe(false)
    expect('mockMethods' in plain).toBe(false)
    expect('reflection' in plain).toBe(false)
    expect('tls' in plain).toBe(false)
  })

  it('defaults an optional-light mock method (no status/trailers/script)', () => {
    const original = new GrpcRequest({
      id: 'r2',
      name: 'Mock2',
      server: true,
      url: 'localhost:50052',
      mockMethods: [{ service: 'm.S', method: 'P', callType: 'unary', responseMessage: '{}' }]
    })
    const restored = GrpcRequest.fromPlain(original.toPlainObject() as unknown as Parameters<typeof GrpcRequest.fromPlain>[0])
    const m = (restored.mockMethods ?? [])[0]
    if (!m) throw new Error('mock method missing')
    expect(m.statusCode).toBeUndefined()
    expect(m.trailers).toBeUndefined()
    expect(m.script).toBeUndefined()
    expect(m.responseMessage).toBe('{}')
  })
})

/**
 * `transport` is always set: a request that names none is the native gRPC
 * client, and it persists that explicitly rather than by omission.
 */
describe('GrpcRequest — transport', () => {
  it('defaults to native gRPC and persists it explicitly', () => {
    const client = new GrpcRequest({ id: 'c1', name: 'Client', url: 'localhost:9000', service: 's', method: 'M', callType: 'unary' })
    expect(client.transport).toBe('grpc')
    const plain = client.toPlainObject()
    expect(plain['transport']).toBe('grpc')
    const restored = GrpcRequest.fromPlain(plain as unknown as Parameters<typeof GrpcRequest.fromPlain>[0])
    expect(restored.transport).toBe('grpc')
  })

  it.each(['grpc', 'grpc-web', 'connect'] as const)('round-trips transport "%s"', (transport) => {
    const original = new GrpcRequest({ id: 'c2', name: 'Client', url: 'localhost:9000', service: 's', method: 'M', callType: 'unary', transport })
    const restored = GrpcRequest.fromPlain(original.toPlainObject() as unknown as Parameters<typeof GrpcRequest.fromPlain>[0])
    expect(restored.transport).toBe(transport)
  })
})

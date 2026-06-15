import { describe, it, expect } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { resolveGrpcMethod, grpcStatusName } from '../../src/main/services/grpc/grpcProtoLoader'

/**
 * The bundled grpcbin descriptor must resolve each call type's streaming flags
 * correctly off the wire-verified proto — this is what the execution service
 * branches on to pick unary vs server/client/bidi handling. No network here:
 * `resolveGrpcMethod` builds the client + reads the method definition offline.
 */
describe('grpcProtoLoader — bundled grpcbin descriptor', () => {
  const creds = grpc.credentials.createInsecure()
  const resolve = (method: string): ReturnType<typeof resolveGrpcMethod> =>
    resolveGrpcMethod({}, 'localhost:9000', 'grpcbin.GRPCBin', method, creds)

  it('resolves DummyUnary as a unary method (no streaming)', () => {
    const m = resolve('DummyUnary')
    expect(m.requestStream).toBe(false)
    expect(m.responseStream).toBe(false)
  })

  it('resolves DummyServerStream as server-streaming', () => {
    const m = resolve('DummyServerStream')
    expect(m.requestStream).toBe(false)
    expect(m.responseStream).toBe(true)
  })

  it('resolves DummyClientStream as client-streaming', () => {
    const m = resolve('DummyClientStream')
    expect(m.requestStream).toBe(true)
    expect(m.responseStream).toBe(false)
  })

  it('resolves DummyBidirectionalStreamStream as bidirectional', () => {
    const m = resolve('DummyBidirectionalStreamStream')
    expect(m.requestStream).toBe(true)
    expect(m.responseStream).toBe(true)
  })

  it('resolves the service by its bare name too', () => {
    const m = resolveGrpcMethod({}, 'localhost:9000', 'GRPCBin', 'DummyUnary', creds)
    expect(m.requestStream).toBe(false)
  })

  it('throws on an unknown service', () => {
    expect(() => resolveGrpcMethod({}, 'localhost:9000', 'grpcbin.NoSuchService', 'X', creds)).toThrow(/not found/)
  })

  it('throws on an unknown method', () => {
    expect(() => resolve('NoSuchMethod')).toThrow(/method "NoSuchMethod" not found/)
  })

  it('loads an inline proto via protoContent', () => {
    const proto = 'syntax="proto3"; package demo; message E {} service S { rpc Ping (E) returns (E); }'
    const m = resolveGrpcMethod({ protoContent: proto }, 'localhost:1234', 'demo.S', 'Ping', creds)
    expect(m.requestStream).toBe(false)
    expect(m.responseStream).toBe(false)
  })
})

describe('grpcStatusName', () => {
  it('maps numeric codes to canonical names', () => {
    expect(grpcStatusName(0)).toBe('OK')
    expect(grpcStatusName(5)).toBe('NOT_FOUND')
    expect(grpcStatusName(12)).toBe('UNIMPLEMENTED')
  })
})

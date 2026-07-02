// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { resolveGrpcMethod } from './grpcProtoLoader'

/**
 * `resolveGrpcMethod` doesn't dial the address — grpc-js connects lazily on
 * the first call — so resolving against a fake, never-contacted address is
 * safe and exercises only the proto-loader wiring these tests care about.
 */
describe('resolveGrpcMethod — path + codec exposure (gRPC-Web reuse)', () => {
  it('exposes the gRPC path + working protobuf serialize/deserialize for the bundled grpcbin proto', () => {
    const resolved = resolveGrpcMethod({}, 'localhost:1', 'grpcbin.GRPCBin', 'DummyUnary', grpc.credentials.createInsecure())

    expect(resolved.path).toBe('/grpcbin.GRPCBin/DummyUnary')
    expect(resolved.requestStream).toBe(false)
    expect(resolved.responseStream).toBe(false)

    const encoded = resolved.requestSerialize({ f_string: 'hello gRPC-Web' })
    expect(Buffer.isBuffer(encoded)).toBe(true)
    expect(encoded.length).toBeGreaterThan(0)

    const decoded = resolved.responseDeserialize(encoded) as { f_string?: string }
    expect(decoded.f_string).toBe('hello gRPC-Web')
  })

  it('exposes the correct path for a streaming method too', () => {
    const resolved = resolveGrpcMethod({}, 'localhost:1', 'grpcbin.GRPCBin', 'DummyServerStream', grpc.credentials.createInsecure())
    expect(resolved.path).toBe('/grpcbin.GRPCBin/DummyServerStream')
    expect(resolved.responseStream).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { resolveGrpcMethod, grpcStatusName, loadGrpcPackage, enumerateGrpcServices } from '../../src/main/services/grpc/grpcProtoLoader'
import { buildDemoFileDescriptorSet } from './fixtures/grpcDescriptorProtoFixture'

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

describe('loadGrpcPackage + enumerateGrpcServices (server side)', () => {
  it('enumerates every service + its methods with streaming flags from inline content', () => {
    const proto = `syntax = "proto3";
package demo;
message Req {} message Res {}
service Greeter {
  rpc Unary (Req) returns (Res);
  rpc Down (Req) returns (stream Res);
  rpc Up (stream Req) returns (Res);
  rpc Both (stream Req) returns (stream Res);
}`
    const services = enumerateGrpcServices(loadGrpcPackage({ protoContent: proto }))
    const greeter = services.find((s) => s.name === 'demo.Greeter')
    if (!greeter) throw new Error('demo.Greeter not resolved')
    const byName = new Map(greeter.methods.map((m) => [m.name, m]))
    expect(byName.get('Unary')).toMatchObject({ requestStream: false, responseStream: false })
    expect(byName.get('Down')).toMatchObject({ requestStream: false, responseStream: true })
    expect(byName.get('Up')).toMatchObject({ requestStream: true, responseStream: false })
    expect(byName.get('Both')).toMatchObject({ requestStream: true, responseStream: true })
    // The definition is what grpc.Server.addService consumes.
    expect(typeof greeter.definition).toBe('object')
    expect(Object.keys(greeter.definition)).toContain('Unary')
  })

  it('falls back to the bundled grpcbin descriptor when no source is given', () => {
    const services = enumerateGrpcServices(loadGrpcPackage({}))
    expect(services.some((s) => s.name === 'grpcbin.GRPCBin')).toBe(true)
  })

  it('prefers a reflected protoDescriptorSet over protoContent/protoPath (freshest source wins)', () => {
    const base64 = buildDemoFileDescriptorSet().toString('base64')
    const staleProto = 'syntax="proto3"; package stale; message E {} service S { rpc Ping (E) returns (E); }'
    const services = enumerateGrpcServices(loadGrpcPackage({ protoDescriptorSet: base64, protoContent: staleProto }))
    expect(services.some((s) => s.name === 'demo.Greeter')).toBe(true)
    expect(services.some((s) => s.name === 'stale.S')).toBe(false)
  })

  it('falls through to protoContent when protoDescriptorSet is empty', () => {
    const proto = 'syntax="proto3"; package demo2; message E {} service S { rpc Ping (E) returns (E); }'
    const services = enumerateGrpcServices(loadGrpcPackage({ protoDescriptorSet: '', protoContent: proto }))
    expect(services.some((s) => s.name === 'demo2.S')).toBe(true)
  })
})

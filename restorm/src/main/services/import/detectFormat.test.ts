// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { detectFormat } from './ImportManager'

describe('detectFormat — operator grouping (gRPC / SOAP)', () => {
  it('detects gRPC from `syntax = "proto3"`', () => {
    expect(detectFormat('syntax = "proto3";\nmessage M {}')).toBe('grpc')
  })

  it('detects gRPC from service + rpc together', () => {
    expect(detectFormat('service Foo {\n  rpc Bar (X) returns (Y);\n}')).toBe('grpc')
  })

  it('does NOT mis-detect gRPC from `service ` alone (the && group must hold)', () => {
    // `service ` without `rpc ` must not match — proves `(service && rpc)`
    // is grouped, not `service || rpc`.
    expect(detectFormat('service desk hours: 9-5')).not.toBe('grpc')
  })

  it('detects SOAP from <wsdl:definitions', () => {
    expect(detectFormat('<wsdl:definitions xmlns="...">')).toBe('soap')
  })

  it('detects SOAP from <definitions only when it also mentions wsdl', () => {
    expect(detectFormat('<definitions targetNamespace="http://x/wsdl">')).toBe('soap')
  })

  it('does NOT mis-detect SOAP from a bare <definitions without wsdl', () => {
    expect(detectFormat('<definitions><term>hello</term></definitions>')).not.toBe('soap')
  })
})

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

describe('detectFormat — extension-anchored match beats greedy content sniffs', () => {
  // Regression: with every importer merged, Smithy's `namespace … service {`
  // sniff (registered before Thrift) claimed `.thrift` files, and Thrift's
  // `^namespace` sniff (registered before TypeSpec) claimed `.tsp` files —
  // because detection was registration-order. A known file extension is an
  // unambiguous signal and must win.
  const thriftIdl = 'namespace com.example.petstore\n\nservice PetService {\n  Pet getPet(1: i64 id)\n}'
  const typespecSrc = 'import "@typespec/http";\n\n@service(#{ title: "Pet Store" })\nnamespace PetStore;'

  it('routes a .thrift file to Thrift even though Smithy would sniff it', () => {
    // Sanity: Smithy's sniff genuinely matches this content when unanchored.
    expect(detectFormat(thriftIdl)).toBe('smithy')
    // …but the extension anchors it to Thrift.
    expect(detectFormat(thriftIdl, '/x/petstore.thrift')).toBe('thrift')
  })

  it('routes a .tsp file to TypeSpec even though Thrift would sniff it', () => {
    // Sanity: Thrift's `^namespace` sniff matches this content when unanchored.
    expect(detectFormat(typespecSrc)).toBe('thrift')
    // …but the extension anchors it to TypeSpec.
    expect(detectFormat(typespecSrc, '/x/petstore.tsp')).toBe('typespec')
  })

  it('routes a .smithy file to Smithy', () => {
    expect(detectFormat(thriftIdl, '/x/model.smithy')).toBe('smithy')
  })
})

// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('detectFormat — JSON parsed once per pass, not once per JSON-capable provider', () => {
  // Every JSON-format provider (Swagger, OpenAPI, Postman, Insomnia, Bruno,
  // AsyncAPI, OData, OpenRpc, Trpc, Har, ThunderClient, Paw, Httpie, Smithy)
  // successfully JSON.parses a shape like this before rejecting it on its own
  // discriminator field — the exact "parsed up to ~8-14x per pass" scenario
  // the shared pre-parse in `detectFormat` eliminates.
  it('calls JSON.parse exactly once for a JSON payload no provider claims', () => {
    const spy = vi.spyOn(JSON, 'parse')
    try {
      const content = JSON.stringify({ foo: 'bar' })
      expect(detectFormat(content)).toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('calls JSON.parse exactly once while still detecting the matching format', () => {
    const spy = vi.spyOn(JSON, 'parse')
    try {
      const content = JSON.stringify({ swagger: '2.0', info: {}, paths: {} })
      expect(detectFormat(content)).toBe('swagger')
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('detectFormat — Bruno collections arriving without a filename', () => {
  // A Bruno export pasted into the import dialog or fetched from a URL has no
  // filename to anchor on, and Bruno's own exports carry no top-level
  // `type: 'collection'` — only the collection shape itself identifies it.
  const brunoCollection = readFileSync(
    join(__dirname, '../../../../tests/unit/bruno-petstore.json'),
    'utf-8'
  )

  it('detects a Bruno collection from its content alone', () => {
    expect(detectFormat(brunoCollection)).toBe('bruno')
  })

  it('still detects it when the filename is present', () => {
    expect(detectFormat(brunoCollection, '/x/bruno-petstore.json')).toBe('bruno')
  })

  it('does not claim a Postman collection', () => {
    const postman = JSON.stringify({
      info: { name: 'Petstore', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'List pets', request: { method: 'GET', url: 'https://example.com/pets' } }]
    })
    expect(detectFormat(postman)).toBe('postman')
  })

  it('does not claim a name+version JSON document that is not a collection', () => {
    // A package manifest has both discriminators the old check keyed on.
    const packageJson = JSON.stringify({ name: 'my-app', version: '1.0.0', dependencies: {} })
    expect(detectFormat(packageJson)).not.toBe('bruno')
  })
})

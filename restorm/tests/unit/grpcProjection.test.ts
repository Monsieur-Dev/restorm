/**
 * gRPC projection — proto3 emission, method derivation and served
 * responses, with a validity guarantee: the emitted `.proto` must load
 * back through `@grpc/proto-loader` (the same loader the design server
 * feeds to `@grpc/grpc-js`), so a served design is always a valid gRPC
 * contract.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as protoLoader from '@grpc/proto-loader'
import {
  buildGrpcResponse,
  designGrpcMethods,
  designProtoPackage,
  designProtoServiceName,
  designToProto,
  type GrpcMethod
} from '../../src/shared/design/grpcProjection'
import { buildReferenceApiDesign } from './apiDesignReference'

const LOAD_OPTIONS: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }

function loadProto(proto: string): protoLoader.PackageDefinition {
  const file = join(mkdtempSync(join(tmpdir(), 'restorm-grpc-test-')), 'design.proto')
  writeFileSync(file, proto, 'utf8')
  return protoLoader.loadSync(file, LOAD_OPTIONS)
}

describe('designToProto', () => {
  const design = buildReferenceApiDesign()
  const proto = designToProto(design)

  it('matches the golden proto', async () => {
    await expect(proto).toMatchFileSnapshot('./goldens/petstore.service.proto')
  })

  it('loads back through @grpc/proto-loader as a valid contract', () => {
    const pkgDef = loadProto(proto)
    const keys = Object.keys(pkgDef)
    // The service and the model messages are all present under the package.
    expect(keys).toContain(`${designProtoPackage(design)}.${designProtoServiceName(design)}`)
    expect(keys).toContain(`${designProtoPackage(design)}.User`)
  })

  it('projects the package + service off the design title', () => {
    expect(designProtoPackage(design)).toBe('petstore')
    expect(designProtoServiceName(design)).toBe('PetstoreService')
  })

  it('documents an enum-typed field as a string with the allowed values', () => {
    expect(proto).toContain('// enum: active | suspended | deleted')
    expect(proto).toMatch(/string status = \d+;/)
  })
})

describe('designGrpcMethods', () => {
  const design = buildReferenceApiDesign()
  const methods = designGrpcMethods(design)

  it('derives one unary rpc per route, named from operationId then summary', () => {
    const byName = new Map(methods.map((m) => [m.name, m]))
    expect([...byName.keys()].sort()).toEqual(['CreateAUser', 'GetUser', 'ListUsers'])
  })

  it('marks the list route and wraps its response type', () => {
    const list = designGrpcMethods(design).find((m) => m.name === 'ListUsers')
    expect(list?.list).toBe(true)
    expect(list?.responseType).toBe('UserList')
  })

  it('carries the path-parameter names of a by-id route', () => {
    const get = designGrpcMethods(design).find((m) => m.name === 'GetUser')
    expect(get?.pathParams).toEqual(['id'])
    expect(get?.responseType).toBe('User')
  })
})

describe('buildGrpcResponse', () => {
  const design = buildReferenceApiDesign()
  const methods = designGrpcMethods(design)
  const pick = (name: string): GrpcMethod => {
    const m = methods.find((x) => x.name === name)
    if (m === undefined) throw new Error(`missing method ${name}`)
    return m
  }

  it('answers a single route with the bound named example', () => {
    const response = buildGrpcResponse(design, pick('GetUser'), { id: 'anything' })
    // The route binds example-user-admin: its declared values win, the
    // rest seed — the served shape is the SAME kernel the HTTP/OData
    // projections use, so every served property is present.
    expect(response['email']).toBe('admin@example.com')
    expect(response['status']).toBe('active')
    expect(response).toHaveProperty('id')
  })

  it('answers a list route with the pagination envelope', () => {
    const response = buildGrpcResponse(design, pick('ListUsers'), { limit: 2, offset: 0 })
    expect(Array.isArray(response['items'])).toBe(true)
    expect((response['items'] as unknown[]).length).toBeLessThanOrEqual(2)
    expect(typeof response['total']).toBe('number')
    expect(response['limit']).toBe(2)
    expect(response['offset']).toBe(0)
  })

  it('is deterministic across calls (seeded)', () => {
    const get = pick('GetUser')
    expect(buildGrpcResponse(design, get, { id: '7' })).toEqual(buildGrpcResponse(design, get, { id: '7' }))
  })
})

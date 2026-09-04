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

  it('carries route deprecation as a method option that survives proto-loader', () => {
    // `route-user-list` is flagged deprecated → the proto emits a method-level
    // `option deprecated = true;`. proto-loader (and, downstream, reflection)
    // decodes it onto the method definition — the flag the design clients dim
    // on. Guards the green-but-dead trap where the option is emitted but the
    // reflection round-trip drops it.
    const pkgDef = loadProto(proto) as Record<string, Record<string, { options?: { deprecated?: boolean } }>>
    const svc = pkgDef[`${designProtoPackage(design)}.${designProtoServiceName(design)}`]
    expect(svc?.['ListUser']?.options?.deprecated).toBe(true)
    expect(svc?.['GetUser']?.options?.deprecated).toBe(false)
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

  it('derives one unary rpc per route, named from operationId then method+type', () => {
    const byName = new Map(methods.map((m) => [m.name, m]))
    expect([...byName.keys()].sort()).toEqual(['GetUser', 'ListUser', 'PostUser'])
  })

  it('marks the list route and wraps its response type', () => {
    const list = designGrpcMethods(design).find((m) => m.name === 'ListUser')
    expect(list?.list).toBe(true)
    expect(list?.responseType).toBe('UserList')
    // The list route is the design's deprecated one — the method carries it.
    expect(list?.deprecated).toBe(true)
    expect(designGrpcMethods(design).find((m) => m.name === 'GetUser')?.deprecated).toBeUndefined()
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
    const response = buildGrpcResponse(design, pick('ListUser'), { limit: 2, offset: 0 })
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

  it('coerces a string-valued number field to a double (not 0)', () => {
    const d = buildReferenceApiDesign()
    const user = d.models.find((m) => m.id === 'model-user')
    expect(user).toBeDefined()
    user?.properties.push({ id: 'prop-user-price', doc: { name: 'price', type: 'number' } } as never)
    const example = user?.examples?.[0]
    if (example !== undefined) example.values['prop-user-price'] = '3.14'
    const get = designGrpcMethods(d).find((m) => m.name === 'GetUser')
    expect(get).toBeDefined()
    const response = get !== undefined ? buildGrpcResponse(d, get, { id: 'x' }) : {}
    expect(response['price']).toBe(3.14)
  })
})

describe('designToProto — name collisions', () => {
  it('dedupes colliding message names and stays loadable', () => {
    const design = buildReferenceApiDesign()
    // A model literally named `Empty` (collides with the built-in), plus a
    // model whose name sanitizes to the same identifier as `User`.
    design.models.push({ id: 'm-empty', doc: { name: 'Empty' }, properties: [{ id: 'm-empty-id', doc: { name: 'id', type: 'string' } }] } as never)
    design.models.push({ id: 'm-lower', doc: { name: 'user' }, properties: [{ id: 'm-lower-id', doc: { name: 'id', type: 'string' } }] } as never)
    const proto = designToProto(design)
    // Still a valid contract the loader accepts (a duplicate `message` would throw).
    expect(() => loadProto(proto)).not.toThrow()
    // No duplicate `message X {` declaration.
    const names = [...proto.matchAll(/^message (\w+) \{/gm)].map((m) => m[1])
    expect(names.length).toBe(new Set(names).size)
  })
})

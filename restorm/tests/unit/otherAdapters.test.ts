import { describe, it, expect } from 'vitest'
import { openapi3ImportAdapter } from '../../src/main/services/import/idempotent/OpenAPI3Adapter'
import { postmanImportAdapter } from '../../src/main/services/import/idempotent/PostmanAdapter'
import { insomniaImportAdapter } from '../../src/main/services/import/idempotent/InsomniaAdapter'
import { brunoImportAdapter } from '../../src/main/services/import/idempotent/BrunoAdapter'
import { asyncapiImportAdapter } from '../../src/main/services/import/idempotent/AsyncAPIAdapter'
import { grpcImportAdapter } from '../../src/main/services/import/idempotent/GrpcAdapter'
import { soapImportAdapter } from '../../src/main/services/import/idempotent/SoapAdapter'
import { odataImportAdapter } from '../../src/main/services/import/idempotent/ODataAdapter'

describe('openapi3ImportAdapter', () => {
  it('produces one operation per (path × method) pair with naturalKey "METHOD path"', () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'API', version: '1.0.0' },
      paths: {
        '/pets/{id}': {
          get: { operationId: 'getPet', summary: 'Find a pet', parameters: [{ name: 'id', in: 'path', schema: { type: 'string' }, required: true }] },
          delete: { operationId: 'deletePet', deprecated: true }
        }
      }
    }
    const out = openapi3ImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations.map((o) => o.naturalKey).sort()).toEqual(['DELETE /pets/{id}', 'GET /pets/{id}'])
    expect(out.operations.find((o) => o.naturalKey === 'DELETE /pets/{id}')?.deprecated).toBe(true)
  })

  it('extracts components.schemas as models and pulls enums', () => {
    const spec = {
      info: { version: '1' },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              status: { type: 'string', enum: ['available', 'sold'] }
            },
            required: ['id']
          }
        }
      }
    }
    const out = openapi3ImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.models[0]?.name).toBe('Pet')
    expect(out.enums.find((e) => e.values.includes('available'))).toBeTruthy()
  })

  it('captures requestBody schema in shape.bodySchema', () => {
    // Pin the body roundtrip — without it, refresh wouldn't surface
    // body changes (fields added / removed in the request payload),
    // which is exactly the kind of breaking spec change refresh
    // exists to flag.
    const spec = {
      paths: {
        '/pets': {
          post: { operationId: 'addPet', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } } }
        }
      }
    }
    const out = openapi3ImportAdapter.extractNormalizedSpec(spec, {})
    const op = out.operations[0]
    expect((op?.shape as { bodySchema?: unknown }).bodySchema).toBeTruthy()
  })
})

describe('postmanImportAdapter', () => {
  it('flattens the item tree and prefixes naturalKey with the folder path', () => {
    const spec = {
      info: { name: 'Demo', version: '1.0.0' },
      item: [
        { name: 'Public', item: [{ name: 'Get', request: { method: 'GET', url: '/x' }, _postman_id: 'abc' }] }
      ]
    }
    const out = postmanImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations).toHaveLength(1)
    expect(out.operations[0]?.naturalKey).toBe('postman Public::GET Get')
    expect(out.operations[0]?.operationId).toBe('abc')
  })

  it('reads the structured version object', () => {
    const spec = { info: { version: { major: 2, minor: 1, patch: 0 } }, item: [] }
    const out = postmanImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.version).toBe('2.1.0')
  })
})

describe('insomniaImportAdapter', () => {
  it('skips request_group resources and reconstructs the folder path from parentId', () => {
    // Pin the folder-path reconstruction — Insomnia's flat resources[]
    // discriminated by parentId is the only place we can recover the
    // tree. Without this, two requests in different folders would
    // collide on naturalKey and the refresh would treat them as the
    // same operation.
    const spec = {
      resources: [
        { _id: 'g1', _type: 'request_group', name: 'Pets', parentId: 'wrk' },
        { _id: 'r1', _type: 'request', name: 'List', method: 'GET', url: '/pets', parentId: 'g1' },
        { _id: 'r2', _type: 'request', name: 'List', method: 'GET', url: '/users', parentId: 'wrk' }
      ]
    }
    const out = insomniaImportAdapter.extractNormalizedSpec(spec, {})
    const keys = out.operations.map((o) => o.naturalKey).sort()
    expect(keys).toEqual(['insomnia ::GET List', 'insomnia Pets::GET List'])
  })
})

describe('brunoImportAdapter', () => {
  it('walks the items tree and prefixes naturalKey with the folder path', () => {
    const spec = {
      version: '1.0',
      items: [
        { name: 'Pets', items: [{ name: 'Get', method: 'GET', url: '/pets' }] }
      ]
    }
    const out = brunoImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations[0]?.naturalKey).toBe('bruno Pets::GET Get')
  })
})

describe('asyncapiImportAdapter', () => {
  it('produces one operation per (channel × action)', () => {
    const spec = {
      info: { version: '2.0.0' },
      channels: {
        'pet/created': {
          publish: { operationId: 'petCreated', summary: 'A pet was created' },
          subscribe: { operationId: 'onPetCreated', deprecated: true }
        }
      }
    }
    const out = asyncapiImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations.map((o) => o.naturalKey).sort()).toEqual(['publish pet/created', 'subscribe pet/created'])
    expect(out.operations.find((o) => o.naturalKey === 'subscribe pet/created')?.deprecated).toBe(true)
  })
})

describe('grpcImportAdapter', () => {
  it('produces one operation per service.method, qualified with the package', () => {
    const spec = {
      package: 'pet',
      services: [{ name: 'Pets', methods: [{ name: 'Get', inputType: 'GetReq', outputType: 'Pet' }] }]
    }
    const out = grpcImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations[0]?.naturalKey).toBe('pet.Pets/Get')
  })

  it('extracts message types as models with deprecation', () => {
    const spec = {
      services: [],
      messages: [{ name: 'Pet', deprecated: true, fields: [{ name: 'id', type: 'string' }] }]
    }
    const out = grpcImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.models[0]?.deprecated).toBe(true)
  })
})

describe('soapImportAdapter', () => {
  it('produces one operation per portType.operation', () => {
    const spec = {
      portTypes: [{ name: 'PetService', operations: [{ name: 'getPet', soapAction: 'urn:getPet' }] }]
    }
    const out = soapImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations[0]?.naturalKey).toBe('PetService/getPet')
    expect(out.operations[0]?.operationId).toBe('urn:getPet')
  })
})

describe('odataImportAdapter', () => {
  it('emits naturalKey "kind name" so EntitySet vs Action with the same name don\'t collide', () => {
    // Pin the kind-prefix invariant — an EntitySet "Pets" and a
    // function "Pets" must not match on refresh.
    const spec = {
      entitySets: [{ name: 'Pets', entityType: 'Pet' }],
      operations: [{ name: 'Pets', kind: 'function' as const }]
    }
    const out = odataImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.operations.map((o) => o.naturalKey).sort()).toEqual(['entitySet Pets', 'function Pets'])
  })

  it('extracts EnumType members as enums', () => {
    const spec = {
      enumTypes: [{ name: 'PetStatus', members: [{ name: 'Available' }, { name: 'Sold' }] }]
    }
    const out = odataImportAdapter.extractNormalizedSpec(spec, {})
    expect(out.enums[0]?.values).toEqual(['Available', 'Sold'])
  })
})

describe('all adapters are byte-identical on two parses', () => {
  // Adapter idempotency is the foundational invariant — without it,
  // the pipeline's "same spec → empty diff" guarantee bubbles up to
  // the adapter and becomes flaky. Pinned for every adapter so a
  // future refactor can't break one without us noticing.
  const cases = [
    { adapter: openapi3ImportAdapter, spec: { paths: { '/x': { get: { operationId: 'g' } } } } },
    { adapter: postmanImportAdapter, spec: { item: [{ name: 'g', request: { method: 'GET', url: '/x' } }] } },
    { adapter: insomniaImportAdapter, spec: { resources: [{ _id: 'r', _type: 'request', name: 'g', method: 'GET', url: '/x' }] } },
    { adapter: brunoImportAdapter, spec: { items: [{ name: 'g', method: 'GET', url: '/x' }] } },
    { adapter: asyncapiImportAdapter, spec: { channels: { 'a': { publish: { operationId: 'p' } } } } },
    { adapter: grpcImportAdapter, spec: { services: [{ name: 'S', methods: [{ name: 'M' }] }] } },
    { adapter: soapImportAdapter, spec: { portTypes: [{ name: 'P', operations: [{ name: 'op' }] }] } },
    { adapter: odataImportAdapter, spec: { entitySets: [{ name: 'Pets' }] } }
  ]
  for (const { adapter, spec } of cases) {
    it(`${adapter.format} adapter is idempotent`, () => {
      expect(JSON.stringify(adapter.extractNormalizedSpec(spec, {})))
        .toBe(JSON.stringify(adapter.extractNormalizedSpec(spec, {})))
    })
  }
})

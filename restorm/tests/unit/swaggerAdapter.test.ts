import { describe, it, expect } from 'vitest'
import { swaggerImportAdapter } from '../../src/main/services/import/idempotent/SwaggerAdapter'
import type { HttpOperationShape } from '../../src/main/services/import/idempotent/types'

const minimalSpec = {
  swagger: '2.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pet/{petId}': {
      get: {
        operationId: 'getPetById',
        summary: 'Find pet by ID',
        deprecated: false,
        parameters: [
          { name: 'petId', in: 'path', type: 'integer', required: true, description: 'pet id' }
        ]
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete pet',
        deprecated: true,
        parameters: [{ name: 'petId', in: 'path', type: 'integer', required: true }]
      }
    },
    '/pet': {
      parameters: [{ name: 'apiVersion', in: 'header', type: 'string' }],
      post: { operationId: 'addPet', summary: 'Add pet' }
    }
  },
  definitions: {
    Pet: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        status: { type: 'string', enum: ['available', 'pending', 'sold'], description: 'status' }
      },
      required: ['id']
    },
    OldType: { type: 'string', deprecated: true }
  }
}

describe('swaggerImportAdapter.extractNormalizedSpec', () => {
  it('emits one operation per (path, method) with METHOD path natural keys', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    expect(spec.operations.map((o) => o.naturalKey).sort()).toEqual([
      'DELETE /pet/{petId}',
      'GET /pet/{petId}',
      'POST /pet'
    ])
  })

  it('captures operationId, deprecation, and the parameter list per op', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    const get = spec.operations.find((o) => o.operationId === 'getPetById')
    if (!get) throw new Error('getPetById missing')
    expect(get.deprecated).toBe(false)
    expect(get.name).toBe('Find pet by ID')
    const httpShape = get.shape as HttpOperationShape
    expect(httpShape.protocol).toBe('http')
    expect(httpShape.method).toBe('GET')
    expect(httpShape.url).toBe('/pet/{petId}')
    expect(httpShape.parameters.map((p) => p.name)).toEqual(['petId'])

    const del = spec.operations.find((o) => o.operationId === 'deletePet')
    expect(del?.deprecated).toBe(true)
  })

  it('inherits path-level parameters into every method on that path', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    const post = spec.operations.find((o) => o.operationId === 'addPet')
    if (!post) throw new Error('addPet missing')
    const httpShape = post.shape as HttpOperationShape
    // Path-level `apiVersion` header inherited even though `addPet`
    // declared no `parameters` of its own — common Swagger pattern
    // for cross-cutting headers.
    expect(httpShape.parameters.map((p) => p.name)).toEqual(['apiVersion'])
  })

  it('extracts spec.info.version onto the normalized spec', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    expect(spec.version).toBe('1.0.0')
  })

  it('flattens definitions into normalized models with deprecation', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    const pet = spec.models.find((m) => m.name === 'Pet')
    expect(pet?.properties.map((p) => p.name)).toEqual(['id', 'status'])
    expect(pet?.properties.find((p) => p.name === 'id')?.required).toBe(true)
    expect(pet?.properties.find((p) => p.name === 'status')?.required).toBe(false)

    const oldType = spec.models.find((m) => m.name === 'OldType')
    expect(oldType?.deprecated).toBe(true)
  })

  it('extracts property-level enums into the normalized enum list', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    const statusEnum = spec.enums.find((e) => e.name === 'Pet status')
    expect(statusEnum?.values).toEqual(['available', 'pending', 'sold'])
  })

  it('does not attempt to materialise environments', () => {
    const spec = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    // Environments only land on initial import via the legacy
    // SwaggerImportService — the refresh-in-place path doesn't
    // touch them. Pin the contract.
    expect(spec.environments).toEqual([])
  })

  it('produces an identical NormalizedSpec on two parses of the same source (idempotency upstream of the pipeline)', () => {
    // The pipeline guarantees idempotency at the merge layer; this
    // pins it at the *adapter* layer too — same input => same
    // normalized output, byte-for-byte. Without this guarantee the
    // pipeline's "no-op on re-import" invariant would shift to the
    // adapter and become flaky.
    const first = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    const second = swaggerImportAdapter.extractNormalizedSpec(minimalSpec, {})
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openapi3ToApiDocumentation,
  expandServerVariables,
  pickPrimaryContentType,
  type OAS3Spec
} from '../../../../src/main/services/import/transformers/openapi3ToApiDocumentation'

const FIXTURES = join(__dirname, '../../fixtures/openapi')
const loadFixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'))

describe('openapi3ToApiDocumentation — petstore-3.0', () => {
  const spec = loadFixture('petstore-3.0.json') as OAS3Spec

  it('emits sourceType "openapi" (not "swagger") for OAS 3.x', () => {
    const doc = openapi3ToApiDocumentation(spec)
    expect(doc.sourceType).toBe('openapi')
  })

  it('maps api info fields', () => {
    const doc = openapi3ToApiDocumentation(spec)
    expect(doc.api.title).toBe('Petstore')
    expect(doc.api.description).toBe('Sample 3.0 API')
    expect(doc.api.version).toBe('1.0.0')
    expect(doc.api.contact).toEqual({ name: 'Team', email: 'team@example.com' })
  })

  it('derives the server block from the first servers[] entry', () => {
    const doc = openapi3ToApiDocumentation(spec)
    expect(doc.server?.host).toBe('petstore3.swagger.io')
    expect(doc.server?.basePath).toBe('/api/v3')
    expect(doc.server?.schemes).toEqual(['https'])
  })

  it('maps tags into groups', () => {
    const doc = openapi3ToApiDocumentation(spec)
    expect(doc.groups.pet).toEqual({ name: 'pet', description: 'Pet operations' })
    expect(doc.groups.store).toEqual({ name: 'store' })
  })

  it('maps components.schemas into models with required + ref-named properties', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const pet = doc.models.Pet
    expect(pet).toBeDefined()
    expect(pet?.properties.find((p) => p.name === 'name')?.required).toBe(true)
    expect(pet?.properties.find((p) => p.name === 'category')?.type).toBe('Category')
  })

  it('emits one operation per (path, method)', () => {
    const doc = openapi3ToApiDocumentation(spec)
    // findPetsByStatus, getPetById, deletePet, addPet
    expect(doc.operations).toHaveLength(4)
    const get = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(get?.match).toEqual({ urlPattern: '/pet/{petId}', method: 'GET' })
    expect(get?.group).toBe('pet')
  })

  it('synthesizes an `in: body` parameter from `requestBody`', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const post = doc.operations.find((op) => op.operationId === 'addPet')
    const bodyParam = post?.parameters?.find((p) => p.location === 'body')
    expect(bodyParam).toBeDefined()
    expect(bodyParam?.required).toBe(true)
    expect(bodyParam?.type).toBe('Pet')
  })

  it('pulls referenced models from request body, response content, and array items', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const get = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(get?.referencedModels).toContain('Pet')
    const findByStatus = doc.operations.find((op) => op.operationId === 'findPetsByStatus')
    expect(findByStatus?.referencedModels).toContain('Pet')
  })

  it('responses map to the primary content schema name (JSON wins over XML)', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const get = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(get?.responses?.['200']?.schema).toBe('Pet')
  })

  it('derives consumes/produces from request/response content keys', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const post = doc.operations.find((op) => op.operationId === 'addPet')
    expect(post?.consumes).toEqual(expect.arrayContaining(['application/json', 'application/xml', 'application/x-www-form-urlencoded']))
    const get = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(get?.produces).toEqual(expect.arrayContaining(['application/json', 'application/xml']))
  })

  it('preserves sourceUrl when passed in options', () => {
    const doc = openapi3ToApiDocumentation(spec, { sourceUrl: 'https://example.com/openapi.json' })
    expect(doc.sourceUrl).toBe('https://example.com/openapi.json')
  })
})

describe('openapi3ToApiDocumentation — multi-server-3.0', () => {
  const spec = loadFixture('multi-server-3.0.json') as OAS3Spec

  it('expands server-template variables for the docs server block', () => {
    const doc = openapi3ToApiDocumentation(spec)
    // First server: https://prod.api.example.com:443/v2 → host:prod.api.example.com:443, basePath:/v2
    expect(doc.server?.host).toBe('prod.api.example.com')
    expect(doc.server?.basePath).toBe('/v2')
    expect(doc.server?.schemes).toEqual(['https'])
  })

  it('keeps non-default ports as part of `host` (mirrors WHATWG `URL.host` semantics)', () => {
    // Synthesize a tiny spec with `http://localhost:3000` to lock in the
    // contract: `host` includes `:3000`, but `:443` (default for https) is
    // dropped by `URL.host`.
    const localSpec: OAS3Spec = {
      openapi: '3.0.0',
      info: { title: 'L', version: '1' },
      servers: [{ url: 'http://localhost:3000' }],
      paths: {}
    }
    const doc = openapi3ToApiDocumentation(localSpec)
    expect(doc.server?.host).toBe('localhost:3000')
    expect(doc.server?.schemes).toEqual(['http'])
  })
})

describe('helpers', () => {
  it('expandServerVariables substitutes default + first-enum + empty fallback', () => {
    expect(expandServerVariables({ url: 'https://{env}.api/{base}', variables: { env: { default: 'prod' }, base: { default: 'v2' } } }))
      .toBe('https://prod.api/v2')
    // No default → fall through to first enum.
    expect(expandServerVariables({ url: 'https://{r}.api', variables: { r: { default: undefined as unknown as string, enum: ['eu', 'us'] } } }))
      .toBe('https://eu.api')
    // No variables → return as-is.
    expect(expandServerVariables({ url: 'https://api' })).toBe('https://api')
  })

  it('pickPrimaryContentType prefers JSON, falls back to first declared key', () => {
    expect(pickPrimaryContentType({ 'application/xml': {}, 'application/json': {} })).toBe('application/json')
    expect(pickPrimaryContentType({ 'application/vnd.api+json': {}, 'application/xml': {} })).toBe('application/vnd.api+json')
    expect(pickPrimaryContentType({ 'application/xml': {}, 'text/plain': {} })).toBe('application/xml')
    expect(pickPrimaryContentType(undefined)).toBeUndefined()
    expect(pickPrimaryContentType({})).toBeUndefined()
  })
})

describe('openapi3ToApiDocumentation — multi-content-type', () => {
  const spec = loadFixture('multi-content-type-3.0.json') as OAS3Spec

  it('preserves the JSON schema name as the canonical response schema', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const op = doc.operations[0]
    expect(op?.responses?.['200']?.schema).toBe('object')
  })

  it('records every content key in `consumes` even when JSON is preferred', () => {
    const doc = openapi3ToApiDocumentation(spec)
    const op = doc.operations[0]
    expect(op?.consumes).toEqual(expect.arrayContaining(['application/json', 'application/xml']))
    expect(op?.produces).toEqual(expect.arrayContaining(['application/json', 'application/xml']))
  })
})

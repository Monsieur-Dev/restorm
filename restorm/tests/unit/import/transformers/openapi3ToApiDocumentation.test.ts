import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openapi3ToApiDocumentation,
  collectStructuralIssues,
  summariseStructuralIssues,
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

describe('openapi3ToApiDocumentation — security parsing', () => {
  const securedSpec: OAS3Spec = {
    openapi: '3.0.0',
    info: { title: 'Secured', version: '1.0.0' },
    paths: {},
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'project key'
        },
        basicAuth: { type: 'http', scheme: 'basic' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        petstoreOAuth: {
          type: 'oauth2',
          flows: {
            implicit: {
              authorizationUrl: 'https://example.com/oauth/authorize',
              scopes: { 'read:pets': 'read your pets', 'write:pets': 'modify your pets' }
            },
            authorizationCode: {
              authorizationUrl: 'https://example.com/oauth/authorize',
              tokenUrl: 'https://example.com/oauth/token',
              refreshUrl: 'https://example.com/oauth/refresh',
              scopes: { 'read:pets': 'read your pets' }
            }
          }
        },
        oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://example.com/.well-known/openid-configuration' }
      }
    } as OAS3Spec['components']
  }

  it('exposes apiKey, http (basic + bearer) and openIdConnect schemes', () => {
    const doc = openapi3ToApiDocumentation(securedSpec)
    expect(doc.securitySchemes?.['apiKey']).toEqual({
      type: 'apiKey',
      name: 'X-API-Key',
      in: 'header',
      description: 'project key'
    })
    expect(doc.securitySchemes?.['basicAuth']).toEqual({ type: 'http', scheme: 'basic' })
    expect(doc.securitySchemes?.['bearerAuth']).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    expect(doc.securitySchemes?.['oidc']).toEqual({
      type: 'openIdConnect',
      openIdConnectUrl: 'https://example.com/.well-known/openid-configuration'
    })
  })

  it('renames OpenAPI 3.x flow keys onto the Swagger 2.0 vocabulary', () => {
    const doc = openapi3ToApiDocumentation(securedSpec)
    const oauth = doc.securitySchemes?.['petstoreOAuth']
    expect(oauth?.type).toBe('oauth2')
    const flowTypes = oauth?.flows?.map((f) => f.type)
    expect(flowTypes).toEqual(['implicit', 'accessCode'])
    const accessCode = oauth?.flows?.find((f) => f.type === 'accessCode')
    expect(accessCode?.refreshUrl).toBe('https://example.com/oauth/refresh')
    expect(accessCode?.tokenUrl).toBe('https://example.com/oauth/token')
  })

  it('captures the spec-level `security` requirement on `defaultSecurity`', () => {
    const doc = openapi3ToApiDocumentation(securedSpec)
    expect(doc.defaultSecurity).toEqual([{ apiKey: [] }])
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

describe('openapi3ToApiDocumentation — structural validation', () => {
  // A minimal, structurally sound 3.0 spec used as the baseline the invalid
  // variants below diverge from.
  const soundSpec = (): OAS3Spec =>
    ({
      openapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      paths: {
        '/things': {
          post: {
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: { '200': { description: 'ok' } }
          }
        }
      }
    }) as unknown as OAS3Spec

  it('reports no structural issues for a sound spec', () => {
    expect(collectStructuralIssues(soundSpec())).toEqual([])
  })

  it('does NOT crash and does NOT throw on a requestBody missing its content — it imports and flags the problem', () => {
    const spec = soundSpec()
    // The exact shape that used to make the operation walker run
    // `Object.values(undefined)`: a requestBody object with no `content` map.
    ;(spec.paths['/things'].post as { requestBody: unknown }).requestBody = { required: true }
    // Import proceeds (partial-broken specs import what they can) …
    expect(() => openapi3ToApiDocumentation(spec)).not.toThrow()
    // … and the problem is surfaced as a named structural issue, never a bare
    // "Cannot convert undefined or null to object" TypeError.
    const issues = collectStructuralIssues(spec)
    expect(issues.some((i) => i.includes('requestBody without content'))).toBe(true)
    expect(issues.some((i) => i.includes('POST /things'))).toBe(true)
  })

  it('names an unresolved $ref (dangling in-document pointer) as a structural issue', () => {
    const spec = soundSpec()
    ;(spec.paths['/things'].post as { requestBody: unknown }).requestBody = {
      $ref: '#/components/requestBodies/DoesNotExist'
    }
    expect(() => openapi3ToApiDocumentation(spec)).not.toThrow()
    const issues = collectStructuralIssues(spec)
    expect(issues.some((i) => i.includes('unresolved $ref') && i.includes('#/components/requestBodies/DoesNotExist'))).toBe(true)
  })

  it('flags an external file $ref the importer cannot follow', () => {
    const spec = soundSpec()
    const post = spec.paths['/things'].post as { responses: Record<string, { schema?: unknown }> }
    post.responses['200'].schema = { $ref: './models/thing.yaml#/Thing' }
    const issues = collectStructuralIssues(spec)
    expect(issues.some((i) => i.includes('unresolved $ref') && i.includes('./models/thing.yaml#/Thing'))).toBe(true)
  })

  it('summarises a long issue list with a "(+N more)" tail', () => {
    const many = Array.from({ length: 20 }, (_, i) => `unresolved $ref: #/components/schemas/S${i}`)
    const summary = summariseStructuralIssues(many)
    expect(summary).toContain('(+12 more)')
    expect(summary.startsWith('unresolved $ref: #/components/schemas/S0')).toBe(true)
  })
})

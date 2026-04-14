import { describe, it, expect } from 'vitest'
import { swaggerToApiDocumentation, type SwaggerSpec } from '../../../../src/main/services/import/transformers/swaggerToApiDocumentation'

const baseSpec: SwaggerSpec = {
  swagger: '2.0',
  info: {
    title: 'Petstore',
    description: 'Sample API',
    version: '1.0.0',
    contact: { name: 'Team', email: 'team@example.com' },
    license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    termsOfService: 'https://example.com/terms'
  },
  host: 'petstore.swagger.io',
  basePath: '/v2',
  schemes: ['https'],
  tags: [
    { name: 'pet', description: 'Pet operations', externalDocs: { description: 'more', url: 'https://example.com/pet' } },
    { name: 'store' }
  ],
  paths: {
    '/pet/{petId}': {
      get: {
        tags: ['pet'],
        summary: 'Find pet by ID',
        description: 'Returns a single pet',
        operationId: 'getPetById',
        parameters: [
          { name: 'petId', in: 'path', description: 'Pet ID', required: true, type: 'integer', format: 'int64' }
        ],
        responses: {
          '200': { description: 'successful operation', schema: { $ref: '#/definitions/Pet' } },
          '404': { description: 'Pet not found' }
        },
        deprecated: false
      },
      delete: {
        tags: ['pet'],
        summary: 'Delete pet',
        operationId: 'deletePet',
        parameters: [
          { name: 'petId', in: 'path', required: true, type: 'integer' },
          { name: 'api_key', in: 'header', required: false, type: 'string' }
        ],
        responses: { '204': { description: 'deleted' } }
      }
    }
  },
  definitions: {
    Pet: {
      type: 'object',
      required: ['name'],
      properties: {
        id: { type: 'integer', description: 'Unique id' },
        name: { type: 'string' },
        category: { $ref: '#/definitions/Category' }
      }
    },
    Category: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' }
      }
    }
  }
}

describe('swaggerToApiDocumentation', () => {
  it('maps api info fields', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    expect(doc.sourceType).toBe('swagger')
    expect(doc.api.title).toBe('Petstore')
    expect(doc.api.description).toBe('Sample API')
    expect(doc.api.version).toBe('1.0.0')
    expect(doc.api.contact).toEqual({ name: 'Team', email: 'team@example.com' })
    expect(doc.api.license?.name).toBe('MIT')
    expect(doc.api.termsOfService).toBe('https://example.com/terms')
  })

  it('maps server block from host / basePath / schemes', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    expect(doc.server).toEqual({ host: 'petstore.swagger.io', basePath: '/v2', schemes: ['https'] })
  })

  it('maps definitions into models with required flags and $ref type labels', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const pet = doc.models.Pet
    expect(pet).toBeDefined()
    const idProp = pet?.properties.find((p) => p.name === 'id')
    expect(idProp).toEqual({ name: 'id', type: 'integer', required: false, description: 'Unique id' })
    const nameProp = pet?.properties.find((p) => p.name === 'name')
    expect(nameProp?.required).toBe(true)
    const catProp = pet?.properties.find((p) => p.name === 'category')
    expect(catProp?.type).toBe('Category')
  })

  it('maps tags into groups, preserving description + externalDocs', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    expect(doc.groups.pet).toEqual({
      name: 'pet',
      description: 'Pet operations',
      externalDocs: { description: 'more', url: 'https://example.com/pet' }
    })
    expect(doc.groups.store).toEqual({ name: 'store' })
  })

  it('emits one operation per (path, method) pair with match info', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    expect(doc.operations).toHaveLength(2)
    const getPet = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(getPet?.match).toEqual({ urlPattern: '/pet/{petId}', method: 'GET' })
    expect(getPet?.group).toBe('pet')
    expect(getPet?.summary).toBe('Find pet by ID')
  })

  it('maps parameters with location + type + required + description', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const del = doc.operations.find((op) => op.operationId === 'deletePet')
    expect(del?.parameters).toEqual([
      { name: 'petId', location: 'path', type: 'integer', required: true },
      { name: 'api_key', location: 'header', type: 'string', required: false }
    ])
  })

  it('maps responses keyed by status code with $ref schema names', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const getPet = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(getPet?.responses?.['200']).toEqual({ description: 'successful operation', schema: 'Pet' })
    expect(getPet?.responses?.['404']).toEqual({ description: 'Pet not found' })
  })

  it('collects referenced models from parameters and responses', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const getPet = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(getPet?.referencedModels).toContain('Pet')
  })

  it('preserves sourceUrl when passed in options', () => {
    const doc = swaggerToApiDocumentation(baseSpec, { sourceUrl: 'https://example.com/swagger.json' })
    expect(doc.sourceUrl).toBe('https://example.com/swagger.json')
  })

  it('omits sourceUrl when not provided', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    expect(doc.sourceUrl).toBeUndefined()
  })

  it('returns empty models / groups when spec has none', () => {
    const minimal: SwaggerSpec = {
      info: { title: 'Minimal' },
      paths: {}
    }
    const doc = swaggerToApiDocumentation(minimal)
    expect(doc.models).toEqual({})
    expect(doc.groups).toEqual({})
    expect(doc.operations).toEqual([])
  })
})

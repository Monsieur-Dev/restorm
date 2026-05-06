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
          {
            name: 'petId',
            in: 'path',
            description: 'Pet ID',
            required: true,
            type: 'integer',
            format: 'int64',
            minimum: 1,
            maximum: 10
          }
        ],
        responses: {
          '200': {
            description: 'successful operation',
            schema: { $ref: '#/definitions/Pet' },
            examples: { 'application/json': { id: 1, name: 'doggie' } }
          },
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
      },
      post: {
        tags: ['pet'],
        summary: 'Update pet by form data',
        operationId: 'updatePetWithForm',
        parameters: [
          { name: 'petId', in: 'path', required: true, type: 'integer' },
          {
            name: 'status',
            in: 'query',
            type: 'string',
            description: 'New status',
            enum: ['available', 'pending', 'sold'],
            'x-example': 'available',
            allowEmptyValue: false
          },
          {
            name: 'tags',
            in: 'query',
            type: 'array',
            collectionFormat: 'multi',
            uniqueItems: true
          },
          {
            name: 'priceCents',
            in: 'query',
            type: 'integer',
            multipleOf: 100,
            exclusiveMinimum: true,
            minimum: 0
          }
        ],
        responses: { '200': { description: 'updated' } }
      }
    }
  },
  definitions: {
    Pet: {
      type: 'object',
      required: ['name'],
      properties: {
        id: { type: 'integer', description: 'Unique id', readOnly: true },
        name: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-zA-Z]+$' },
        nickname: { type: 'string', nullable: true, example: 'Rex' },
        status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        category: { $ref: '#/definitions/Category' },
        tags: { type: 'array', items: { $ref: '#/definitions/Tag' } }
      }
    },
    Category: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' }
      }
    },
    Tag: {
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
    expect(idProp?.name).toBe('id')
    expect(idProp?.type).toBe('integer')
    expect(idProp?.required).toBe(false)
    expect(idProp?.description).toBe('Unique id')
    const nameProp = pet?.properties.find((p) => p.name === 'name')
    expect(nameProp?.required).toBe(true)
    const catProp = pet?.properties.find((p) => p.name === 'category')
    expect(catProp?.type).toBe('Category')
  })

  it('populates `targetModelRef` for direct $ref properties', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const catProp = doc.models.Pet?.properties.find((p) => p.name === 'category')
    expect(catProp?.targetModelRef).toBe('Category')
    expect(catProp?.isArrayOfRef).toBeUndefined()
  })

  it('populates `targetModelRef` + `isArrayOfRef` for array-of-$ref properties', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const tagsProp = doc.models.Pet?.properties.find((p) => p.name === 'tags')
    expect(tagsProp?.type).toBe('array<Tag>')
    expect(tagsProp?.targetModelRef).toBe('Tag')
    expect(tagsProp?.isArrayOfRef).toBe(true)
  })

  it('leaves `targetModelRef` undefined for primitive properties', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const nameProp = doc.models.Pet?.properties.find((p) => p.name === 'name')
    expect(nameProp?.targetModelRef).toBeUndefined()
    expect(nameProp?.isArrayOfRef).toBeUndefined()
  })

  it('captures property-level nullable + readOnly + example', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const nicknameProp = doc.models.Pet?.properties.find((p) => p.name === 'nickname')
    expect(nicknameProp?.nullable).toBe(true)
    expect(nicknameProp?.example).toBe('Rex')
    const idProp = doc.models.Pet?.properties.find((p) => p.name === 'id')
    expect(idProp?.readOnly).toBe(true)
  })

  it('captures enum values on properties', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const statusProp = doc.models.Pet?.properties.find((p) => p.name === 'status')
    expect(statusProp?.enumValues).toEqual(['available', 'pending', 'sold'])
  })

  it('captures validation constraints on string properties', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const nameProp = doc.models.Pet?.properties.find((p) => p.name === 'name')
    expect(nameProp?.constraints).toEqual({
      minLength: 1,
      maxLength: 80,
      pattern: '^[a-zA-Z]+$'
    })
  })

  it('omits constraints when the property has none', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const idProp = doc.models.Pet?.properties.find((p) => p.name === 'id')
    expect(idProp?.constraints).toBeUndefined()
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
    expect(doc.operations).toHaveLength(3)
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

  it('captures inline parameter constraints from Swagger 2.0 path params', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const getPet = doc.operations.find((op) => op.operationId === 'getPetById')
    const petIdParam = getPet?.parameters?.find((p) => p.name === 'petId')
    expect(petIdParam?.constraints).toEqual({ minimum: 1, maximum: 10 })
  })

  it('honours x-example as parameter example fallback + records enum values', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const update = doc.operations.find((op) => op.operationId === 'updatePetWithForm')
    const statusParam = update?.parameters?.find((p) => p.name === 'status')
    expect(statusParam?.example).toBe('available')
    expect(statusParam?.enumValues).toEqual(['available', 'pending', 'sold'])
    expect(statusParam?.allowEmptyValue).toBe(false)
  })

  it('preserves Swagger 2.0 collectionFormat + uniqueItems on array parameters', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const update = doc.operations.find((op) => op.operationId === 'updatePetWithForm')
    const tagsParam = update?.parameters?.find((p) => p.name === 'tags')
    expect(tagsParam?.collectionFormat).toBe('multi')
    expect(tagsParam?.constraints).toEqual({ uniqueItems: true })
  })

  it('captures multipleOf + exclusiveMinimum on numeric parameters', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const update = doc.operations.find((op) => op.operationId === 'updatePetWithForm')
    const priceParam = update?.parameters?.find((p) => p.name === 'priceCents')
    expect(priceParam?.constraints).toEqual({
      multipleOf: 100,
      exclusiveMinimum: true,
      minimum: 0
    })
  })

  it('exposes models referenced via array-of-ref properties', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    expect(doc.models.Tag).toBeDefined()
    expect(doc.models.Tag?.properties.map((p) => p.name).sort()).toEqual(['id', 'name'])
  })

  it('maps responses keyed by status code with $ref schema names', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const getPet = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(getPet?.responses?.['200']?.description).toBe('successful operation')
    expect(getPet?.responses?.['200']?.schema).toBe('Pet')
    expect(getPet?.responses?.['404']).toEqual({ description: 'Pet not found' })
  })

  it('captures per-content-type response examples', () => {
    const doc = swaggerToApiDocumentation(baseSpec)
    const getPet = doc.operations.find((op) => op.operationId === 'getPetById')
    expect(getPet?.responses?.['200']?.examples).toEqual({
      'application/json': { id: 1, name: 'doggie' }
    })
    expect(getPet?.responses?.['404']?.examples).toBeUndefined()
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

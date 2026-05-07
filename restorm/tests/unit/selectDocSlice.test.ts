import { describe, it, expect } from 'vitest'
import { selectDocSlice } from '../../src/shared/utils/selectDocSlice'
import type { ApiDocumentation } from '../../src/shared/types/apiDocumentation'

const apiDoc: ApiDocumentation = {
  sourceType: 'swagger',
  api: { title: 'Petstore', version: '1.0.0' },
  models: {
    Pet: {
      name: 'Pet',
      properties: [
        { name: 'id', type: 'integer', required: true },
        { name: 'category', type: 'Category', required: false, targetModelRef: 'Category' },
        { name: 'tags', type: 'array<Tag>', required: false, targetModelRef: 'Tag', isArrayOfRef: true }
      ]
    },
    Category: {
      name: 'Category',
      properties: [{ name: 'id', type: 'integer', required: false }]
    },
    Tag: {
      name: 'Tag',
      properties: [{ name: 'id', type: 'integer', required: false }]
    },
    Order: {
      name: 'Order',
      properties: [
        { name: 'id', type: 'integer', required: false },
        { name: 'pet', type: 'Pet', required: false, targetModelRef: 'Pet' }
      ]
    },
    User: {
      name: 'User',
      properties: [{ name: 'username', type: 'string', required: false }]
    }
  },
  groups: {
    pet: { name: 'pet', description: 'Pet operations' },
    store: { name: 'store', description: 'Store operations' },
    user: { name: 'user', description: 'User operations' }
  },
  operations: [
    {
      match: { urlPattern: '/pet/{petId}', method: 'GET' },
      group: 'pet',
      operationId: 'getPetById',
      referencedModels: ['Pet']
    },
    {
      match: { urlPattern: '/store/order', method: 'POST' },
      group: 'store',
      operationId: 'placeOrder',
      referencedModels: ['Order']
    },
    {
      match: { urlPattern: '/user', method: 'POST' },
      group: 'user',
      operationId: 'createUser',
      referencedModels: ['User']
    }
  ]
}

describe('selectDocSlice — env-folder scope (no filters)', () => {
  it('returns every operation, every model, every group', () => {
    const slice = selectDocSlice(apiDoc, undefined)
    expect(slice.operations).toHaveLength(3)
    expect(slice.models).toHaveLength(5)
    expect(slice.groups).toHaveLength(3)
    expect(slice.api.title).toBe('Petstore')
  })

  it('treats an empty filter array the same as `undefined`', () => {
    const slice = selectDocSlice(apiDoc, [])
    expect(slice.operations).toHaveLength(3)
    expect(slice.models).toHaveLength(5)
  })
})

describe('selectDocSlice — folder scope (subset of routes)', () => {
  it('keeps the operations that match the filter and the transitive model closure', () => {
    const slice = selectDocSlice(apiDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    expect(slice.operations.map((op) => op.operationId)).toEqual(['getPetById'])
    // Pet → Category, Pet → Tag (array). Order, User excluded.
    expect(slice.models.map((m) => m.name).sort()).toEqual(['Category', 'Pet', 'Tag'])
  })

  it('only includes groups whose operation matched', () => {
    const slice = selectDocSlice(apiDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    expect(slice.groups.map((g) => g.name)).toEqual(['pet'])
  })

  it('deduplicates when two filters resolve to the same operation', () => {
    const slice = selectDocSlice(apiDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' },
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    expect(slice.operations).toHaveLength(1)
  })
})

describe('selectDocSlice — route scope (single operation)', () => {
  it('GET /pet/{id} produces Pet+Category+Tag, omits Order/User', () => {
    const slice = selectDocSlice(apiDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    const names = slice.models.map((m) => m.name).sort()
    expect(names).toContain('Pet')
    expect(names).toContain('Category')
    expect(names).toContain('Tag')
    expect(names).not.toContain('Order')
    expect(names).not.toContain('User')
  })

  it('skips dangling targetModelRef silently (model name not in `apiDoc.models`)', () => {
    const danglingDoc: ApiDocumentation = {
      ...apiDoc,
      models: {
        ...apiDoc.models,
        Pet: {
          name: 'Pet',
          properties: [
            { name: 'rogue', type: 'Ghost', required: false, targetModelRef: 'Ghost' }
          ]
        }
      }
    }
    const slice = selectDocSlice(danglingDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    expect(slice.models.map((m) => m.name)).toContain('Pet')
    expect(slice.models.map((m) => m.name)).not.toContain('Ghost')
  })
})

describe('selectDocSlice — composition cross-edges', () => {
  it('walks oneOf / anyOf branches into the model closure', () => {
    const polyDoc: ApiDocumentation = {
      ...apiDoc,
      models: {
        Vehicle: {
          name: 'Vehicle',
          properties: [],
          composition: { oneOf: ['Car', 'Boat'] }
        },
        Car: { name: 'Car', properties: [{ name: 'wheels', type: 'integer', required: true }] },
        Boat: { name: 'Boat', properties: [{ name: 'sails', type: 'integer', required: true }] }
      },
      operations: [
        {
          match: { urlPattern: '/vehicle', method: 'GET' },
          operationId: 'getVehicle',
          referencedModels: ['Vehicle']
        }
      ]
    }
    const slice = selectDocSlice(polyDoc, [
      { type: 'http', url: '/vehicle', method: 'GET' }
    ])
    const names = slice.models.map((m) => m.name).sort()
    expect(names).toEqual(['Boat', 'Car', 'Vehicle'])
  })

  it('walks discriminator mapping targets', () => {
    const polyDoc: ApiDocumentation = {
      ...apiDoc,
      models: {
        Pet: {
          name: 'Pet',
          properties: [],
          composition: { discriminator: { propertyName: 'petType', mapping: { dog: 'Dog', cat: 'Cat' } } }
        },
        Dog: { name: 'Dog', properties: [{ name: 'breed', type: 'string', required: true }] },
        Cat: { name: 'Cat', properties: [{ name: 'colour', type: 'string', required: true }] }
      },
      operations: [
        {
          match: { urlPattern: '/pet/{petId}', method: 'GET' },
          operationId: 'getPet',
          referencedModels: ['Pet']
        }
      ]
    }
    const slice = selectDocSlice(polyDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    const names = slice.models.map((m) => m.name).sort()
    expect(names).toEqual(['Cat', 'Dog', 'Pet'])
  })

  it('keeps walking refs reachable from a discriminator target', () => {
    // Pet -> Dog (via discriminator mapping) -> Owner (via property
    // ref). The closure must reach Owner even though no direct
    // operation references it.
    const polyDoc: ApiDocumentation = {
      ...apiDoc,
      models: {
        Pet: {
          name: 'Pet',
          properties: [],
          composition: { discriminator: { propertyName: 'petType', mapping: { dog: 'Dog' } } }
        },
        Dog: {
          name: 'Dog',
          properties: [
            { name: 'breed', type: 'string', required: true },
            { name: 'owner', type: 'Owner', required: false, targetModelRef: 'Owner' }
          ]
        },
        Owner: {
          name: 'Owner',
          properties: [{ name: 'name', type: 'string', required: false }]
        }
      },
      operations: [
        {
          match: { urlPattern: '/pet/{petId}', method: 'GET' },
          operationId: 'getPet',
          referencedModels: ['Pet']
        }
      ]
    }
    const slice = selectDocSlice(polyDoc, [
      { type: 'http', url: '/pet/{petId}', method: 'GET' }
    ])
    const names = slice.models.map((m) => m.name).sort()
    expect(names).toEqual(['Dog', 'Owner', 'Pet'])
  })
})

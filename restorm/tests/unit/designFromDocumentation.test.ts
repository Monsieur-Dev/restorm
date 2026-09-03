import { describe, it, expect } from 'vitest'
import {
  designFromDocumentation,
  specPathToRestorm,
  isEnumShapedModel,
  defaultAuthFromSecurity
} from '../../src/shared/design/designFromDocumentation'
import { designToApiDocumentation } from '../../src/shared/design/apiDesignDoc'
import type { ApiDocumentation } from '../../src/shared/types/apiDocumentation'

let counter = 0
const newId = (): string => `d-${++counter}`

/** A compact petstore-like documentation exercising every mapped fact:
 * an object model with a model reference, an array-of-ref, an enum
 * reference; an enum-shaped model; grouped operations with path/query
 * params, a virtual body parameter, schema'd responses; security. */
function buildReferenceDoc(): ApiDocumentation {
  return {
    sourceType: 'openapi',
    api: { title: 'Petstore', version: '1.0.0', description: 'Pets.' },
    server: { host: 'petstore.example.com', basePath: '/api', schemes: ['https'] },
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    defaultSecurity: [{ bearerAuth: [] }],
    models: {
      Pet: {
        name: 'Pet',
        description: 'A pet.',
        properties: [
          { name: 'id', type: 'integer', format: 'int64', required: true },
          { name: 'status', type: 'string', required: false, targetModelRef: 'PetStatus' },
          { name: 'owner', type: 'Owner', required: false, targetModelRef: 'Owner' },
          { name: 'friends', type: 'array<Pet>', required: false, targetModelRef: 'Pet', isArrayOfRef: true }
        ]
      },
      Owner: {
        name: 'Owner',
        properties: [{ name: 'name', type: 'string', required: true }]
      },
      PetStatus: {
        name: 'PetStatus',
        properties: [],
        enumValues: ['available', 'pending', 'sold']
      }
    },
    groups: {
      pets: { name: 'pets', description: 'Pet management.' }
    },
    operations: [
      {
        match: { urlPattern: '/pets/{petId}', method: 'GET' },
        group: 'pets',
        summary: 'Get a pet',
        parameters: [
          { name: 'petId', location: 'path', type: 'integer', required: true },
          { name: 'verbose', location: 'query', type: 'boolean', required: false }
        ],
        responses: {
          '200': { description: 'The pet.', schema: 'Pet' },
          '404': { description: 'Not found.' }
        }
      },
      {
        match: { urlPattern: '/pets', method: 'POST' },
        group: 'pets',
        summary: 'Create a pet',
        consumes: ['application/json'],
        parameters: [
          { name: 'body', location: 'body', type: 'Pet', required: true }
        ],
        responses: { '201': { description: 'Created.', schema: 'Pet' } }
      },
      {
        match: { urlPattern: '/pets', method: 'GET' },
        group: 'pets',
        summary: 'List pets',
        responses: { '200': { description: 'All pets.', schema: 'array<Pet>' } }
      }
    ]
  }
}

describe('designFromDocumentation', () => {
  it('specPathToRestorm doubles spec braces, leaves doubled ones alone', () => {
    expect(specPathToRestorm('/pets/{petId}')).toBe('/pets/{{petId}}')
    expect(specPathToRestorm('/pets/{{petId}}')).toBe('/pets/{{petId}}')
    expect(specPathToRestorm('/plain')).toBe('/plain')
  })

  it('isEnumShapedModel separates enum schemas from object models', () => {
    const doc = buildReferenceDoc()
    expect(isEnumShapedModel(doc.models['PetStatus'] as never)).toBe(true)
    expect(isEnumShapedModel(doc.models['Pet'] as never)).toBe(false)
  })

  it('defaultAuthFromSecurity maps the documented scheme kinds', () => {
    expect(defaultAuthFromSecurity([{ b: [] }], { b: { type: 'http', scheme: 'bearer' } })).toBe('bearer')
    expect(defaultAuthFromSecurity([{ b: [] }], { b: { type: 'http', scheme: 'basic' } })).toBe('basic')
    expect(defaultAuthFromSecurity([{ k: [] }], { k: { type: 'apiKey', in: 'header', name: 'X-Key' } })).toBe('apiKeyHeader')
    expect(defaultAuthFromSecurity(undefined, undefined)).toBeUndefined()
  })

  it('maps every doc object to its derived design entity — nothing lost', () => {
    const doc = buildReferenceDoc()
    const design = designFromDocumentation('Petstore design', doc, newId)

    // Identity + connection facts carried verbatim.
    expect(design.info).toEqual(doc.api)
    expect(design.server).toEqual(doc.server)
    expect(design.securitySchemes).toEqual(doc.securitySchemes)
    expect(design.defaultSecurity).toEqual(doc.defaultSecurity)
    expect(design.defaultAuth).toBe('bearer')

    // Components: 2 models + 1 enum, docs verbatim.
    expect(design.models.map((m) => m.doc.name).sort()).toEqual(['Owner', 'Pet'])
    expect(design.enums.map((e) => e.doc.name)).toEqual(['PetStatus'])
    expect(design.enums[0]?.doc.enumValues).toEqual(['available', 'pending', 'sold'])

    const pet = design.models.find((m) => m.doc.name === 'Pet')
    const owner = design.models.find((m) => m.doc.name === 'Owner')
    const status = design.enums[0]
    if (pet === undefined || owner === undefined || status === undefined) throw new Error('derived components missing')

    // Every property wrapped with an id; doc rows carried through — except an
    // `array<X>` type label, which is normalised to the canonical `array` form
    // (the element type / array-of-ref lands on `design`, see below).
    const expectedDocs = (doc.models['Pet']?.properties ?? []).map((p) =>
      /^array<.+>$/.test(p.type) ? { ...p, type: 'array' } : p
    )
    expect(pet.properties.map((p) => p.doc)).toEqual(expectedDocs)

    // References derived from targetModelRef, by kind.
    const statusProp = pet.properties.find((p) => p.doc.name === 'status')
    expect(statusProp?.design?.reference).toEqual({ target: 'enum', refId: status.id })
    const ownerProp = pet.properties.find((p) => p.doc.name === 'owner')
    expect(ownerProp?.design?.reference).toEqual({ target: 'model', refId: owner.id })
    const friendsProp = pet.properties.find((p) => p.doc.name === 'friends')
    expect(friendsProp?.design?.reference).toEqual({ target: 'model', refId: pet.id })
    expect(friendsProp?.doc.isArrayOfRef).toBe(true)

    // Routes: one group, three routes, spec braces doubled.
    expect(design.routeGroups).toHaveLength(1)
    const group = design.routeGroups[0]
    if (group === undefined) throw new Error('derived group missing')
    expect(group.doc).toEqual(doc.groups['pets'])
    expect(group.routes).toHaveLength(3)

    const read = group.routes.find((r) => r.doc.match.urlPattern === '/pets/{{petId}}')
    expect(read?.doc.parameters?.map((p) => p.name)).toEqual(['petId', 'verbose'])
    expect(read?.design?.responses?.['200']).toEqual({ modelId: pet.id })

    // The virtual body parameter becomes the body contract, not a row.
    const create = group.routes.find((r) => r.doc.match.method === 'POST')
    expect(create?.doc.parameters).toEqual([])
    expect(create?.design?.body).toEqual({ modelId: pet.id, contentType: 'application/json' })
    expect(create?.design?.responses?.['201']).toEqual({ modelId: pet.id })

    // An array response derives list cardinality.
    const list = group.routes.find((r) => r.doc.match.method === 'GET' && r.doc.match.urlPattern === '/pets')
    expect(list?.design?.responses?.['200']).toEqual({ modelId: pet.id, list: true })

    // Every minted id is unique.
    const ids = [
      design.id,
      ...design.models.map((m) => m.id),
      ...design.models.flatMap((m) => m.properties.map((p) => p.id)),
      ...design.enums.map((e) => e.id),
      ...design.routeGroups.flatMap((g) => [g.id, ...g.routes.map((r) => r.id)])
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('round-trips through serialization untouched (plain JSON design)', () => {
    const design = designFromDocumentation('X', buildReferenceDoc(), newId)
    expect(JSON.parse(JSON.stringify(design))).toEqual(design)
  })
})

describe('tag factoring (doc → design)', () => {
  const twoOps = (tagsA: string[], tagsB: string[]): ApiDocumentation => ({
    sourceType: 'openapi',
    api: { title: 'T' },
    models: {},
    groups: { Pets: { name: 'Pets' } },
    operations: [
      { match: { urlPattern: '/pets', method: 'GET' }, group: 'Pets', tags: tagsA },
      { match: { urlPattern: '/pets/{id}', method: 'GET' }, group: 'Pets', tags: tagsB }
    ]
  })

  it('hoists a tag shared by every route onto the group and drops it from the routes', () => {
    const design = designFromDocumentation('X', twoOps(['pets', 'list'], ['pets', 'detail']), newId)
    const group = design.routeGroups[0]
    expect(group?.doc.tags).toEqual(['pets'])
    expect(group?.routes.map((r) => r.doc.tags)).toEqual([['list'], ['detail']])
  })

  it('leaves tags on the routes when a route in the group does not share them', () => {
    const design = designFromDocumentation('X', twoOps(['pets', 'list'], ['detail']), newId)
    const group = design.routeGroups[0]
    expect(group?.doc.tags).toBeUndefined()
    expect(group?.routes.map((r) => r.doc.tags)).toEqual([['pets', 'list'], ['detail']])
  })

  it('round-trips: the union projection restores every operation tag', () => {
    const design = designFromDocumentation('X', twoOps(['pets', 'list'], ['pets', 'detail']), newId)
    const reprojected = designToApiDocumentation(design)
    // 'pets' hoisted to the group comes back on both operations via the union;
    // the route-specific tag stays on its own operation.
    expect(reprojected.operations[0]?.tags).toEqual(['pets', 'list'])
    expect(reprojected.operations[1]?.tags).toEqual(['pets', 'detail'])
  })
})

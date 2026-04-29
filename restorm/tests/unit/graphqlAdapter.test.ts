import { describe, it, expect } from 'vitest'
import { graphqlImportAdapter } from '../../src/main/services/import/idempotent/GraphQLAdapter'
import type { GraphqlOperationShape } from '../../src/main/services/import/idempotent/types'

const minimalSchema = {
  version: '2.0',
  queries: [
    {
      name: 'getPet',
      description: 'Find a pet',
      args: [{ name: 'id', type: 'ID!', description: 'pet id' }]
    },
    { name: 'listPets', args: [] }
  ],
  mutations: [
    { name: 'addPet', args: [{ name: 'input', type: 'PetInput!' }], deprecated: false },
    { name: 'deletePet', args: [{ name: 'id', type: 'ID!' }], deprecated: true }
  ],
  subscriptions: [{ name: 'petUpdated', args: [] }],
  types: [
    {
      name: 'Pet',
      description: 'A pet',
      fields: [
        { name: 'id', type: 'ID!' },
        { name: 'name', type: 'String!', deprecated: false },
        { name: 'oldField', type: 'String', deprecated: true }
      ]
    }
  ],
  enums: [
    { name: 'PetStatus', values: ['available', 'pending', 'sold'] },
    { name: 'OldEnum', values: ['legacy'], deprecated: true }
  ]
}

describe('graphqlImportAdapter.extractNormalizedSpec', () => {
  it('emits one normalised operation per query, mutation, and subscription', () => {
    const spec = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    expect(spec.operations.map((o) => o.naturalKey).sort()).toEqual([
      'mutation addPet',
      'mutation deletePet',
      'query getPet',
      'query listPets',
      'subscription petUpdated'
    ])
  })

  it('builds an executable GraphQL document with $-prefixed variables', () => {
    const spec = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    const getPet = spec.operations.find((o) => o.naturalKey === 'query getPet')
    if (!getPet) throw new Error('getPet missing')
    const shape = getPet.shape as GraphqlOperationShape
    expect(shape.protocol).toBe('graphql')
    expect(shape.operationType).toBe('query')
    expect(shape.fieldName).toBe('getPet')
    expect(shape.document).toBe('query($id: ID!) {\n  getPet(id: $id)\n}')
  })

  it('captures @deprecated on operations and propagates to NormalizedOperation.deprecated', () => {
    const spec = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    expect(spec.operations.find((o) => o.naturalKey === 'mutation deletePet')?.deprecated).toBe(true)
    expect(spec.operations.find((o) => o.naturalKey === 'mutation addPet')?.deprecated).toBe(false)
  })

  it('flattens types into models with field-level deprecation', () => {
    const spec = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    const pet = spec.models.find((m) => m.name === 'Pet')
    expect(pet?.properties.map((p) => `${p.name}:${p.deprecated ? 'D' : ''}`)).toEqual(['id:', 'name:', 'oldField:D'])
  })

  it('extracts enums verbatim with deprecation', () => {
    const spec = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    expect(spec.enums.find((e) => e.name === 'PetStatus')?.values).toEqual(['available', 'pending', 'sold'])
    expect(spec.enums.find((e) => e.name === 'OldEnum')?.deprecated).toBe(true)
  })

  it('does not produce environments — refresh-in-place leaves them alone', () => {
    const spec = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    expect(spec.environments).toEqual([])
  })

  it('produces byte-identical NormalizedSpec on two parses (adapter idempotency)', () => {
    // Same invariant the Swagger adapter pins — without it, the
    // pipeline's "same spec → empty diff" guarantee shifts to the
    // adapter and becomes flaky.
    const first = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    const second = graphqlImportAdapter.extractNormalizedSpec(minimalSchema, {})
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

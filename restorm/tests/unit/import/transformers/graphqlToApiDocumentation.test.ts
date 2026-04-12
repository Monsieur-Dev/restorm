import { describe, it, expect } from 'vitest'
import { graphqlToApiDocumentation, type ParsedGraphQLSchemaData } from '../../../../src/main/services/import/transformers/graphqlToApiDocumentation'

const parsed: ParsedGraphQLSchemaData = {
  types: [
    {
      name: 'Pet',
      description: 'A pet',
      fields: [
        { name: 'id', type: 'ID!', args: [] },
        { name: 'name', type: 'String!', args: [] },
        { name: 'category', type: 'Category', description: 'Optional category', args: [] }
      ]
    },
    {
      name: 'Category',
      fields: [{ name: 'name', type: 'String', args: [] }]
    }
  ],
  queries: [
    {
      name: 'pet',
      description: 'Fetch a pet by id',
      type: 'Pet',
      args: [{ name: 'id', type: 'ID!' }]
    },
    {
      name: 'version',
      type: 'String',
      args: []
    }
  ],
  mutations: [
    {
      name: 'updatePet',
      type: 'Pet',
      args: [{ name: 'id', type: 'ID!' }, { name: 'name', type: 'String', defaultValue: '"unnamed"' }]
    }
  ],
  subscriptions: []
}

describe('graphqlToApiDocumentation', () => {
  it('sets title and description, uses baseUrl as server.host', () => {
    const doc = graphqlToApiDocumentation(parsed, { name: 'Petstore GQL', baseUrl: 'https://example.com/graphql' })
    expect(doc.sourceType).toBe('graphql')
    expect(doc.api.title).toBe('Petstore GQL')
    expect(doc.server?.host).toBe('https://example.com/graphql')
  })

  it('maps types to models flagging non-null fields as required', () => {
    const doc = graphqlToApiDocumentation(parsed)
    const pet = doc.models.Pet
    expect(pet?.description).toBe('A pet')
    expect(pet?.properties).toEqual([
      { name: 'id', type: 'ID!', required: true },
      { name: 'name', type: 'String!', required: true },
      { name: 'category', type: 'Category', required: false, description: 'Optional category' }
    ])
  })

  it('builds Queries / Mutations groups only when present', () => {
    const doc = graphqlToApiDocumentation(parsed)
    expect(doc.groups.Queries).toEqual({ name: 'Queries' })
    expect(doc.groups.Mutations).toEqual({ name: 'Mutations' })
    expect(doc.groups.Subscriptions).toBeUndefined()
  })

  it('emits one operation per query / mutation with operationType + URL', () => {
    const doc = graphqlToApiDocumentation(parsed, { baseUrl: 'https://example.com/graphql' })
    const pet = doc.operations.find((op) => op.operationId === 'pet')
    expect(pet?.match).toEqual({
      urlPattern: 'https://example.com/graphql',
      operationName: 'pet',
      operationType: 'query'
    })
    const update = doc.operations.find((op) => op.operationId === 'updatePet')
    expect(update?.match.operationType).toBe('mutation')
  })

  it('maps arguments as parameters with argument location, respects required + defaultValue', () => {
    const doc = graphqlToApiDocumentation(parsed)
    const update = doc.operations.find((op) => op.operationId === 'updatePet')
    expect(update?.parameters).toEqual([
      { name: 'id', location: 'argument', type: 'ID!', required: true },
      { name: 'name', location: 'argument', type: 'String', required: false, defaultValue: '"unnamed"' }
    ])
  })

  it('adds referencedModels only for custom types (not scalars)', () => {
    const doc = graphqlToApiDocumentation(parsed)
    const pet = doc.operations.find((op) => op.operationId === 'pet')
    expect(pet?.referencedModels).toEqual(['Pet'])
    const version = doc.operations.find((op) => op.operationId === 'version')
    expect(version?.referencedModels).toBeUndefined()
  })

  it('echoes sourceUrl when provided', () => {
    const doc = graphqlToApiDocumentation(parsed, { sourceUrl: 'https://example.com/schema.graphql' })
    expect(doc.sourceUrl).toBe('https://example.com/schema.graphql')
  })

  it('gracefully handles empty schemas', () => {
    const empty: ParsedGraphQLSchemaData = { types: [], queries: [], mutations: [], subscriptions: [] }
    const doc = graphqlToApiDocumentation(empty)
    expect(doc.operations).toEqual([])
    expect(doc.groups).toEqual({})
    expect(doc.models).toEqual({})
  })
})

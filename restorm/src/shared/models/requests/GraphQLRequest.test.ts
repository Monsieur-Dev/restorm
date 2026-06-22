import { describe, it, expect } from 'vitest'
import { GraphQLRequest } from './GraphQLRequest'

describe('GraphQLRequest server-mode persistence', () => {
  it('round-trips the server config through toPlainObject / fromPlain', () => {
    const original = new GraphQLRequest({
      id: 'gql-1',
      name: 'Pet mock',
      server: true,
      url: 'localhost:4000/graphql',
      schema: 'type Query {\n  pets: [String!]!\n}',
      mockResolvers: '{ "Query.pets": ["Rex", "Whiskers"] }',
      resolverScript: 'return { Query: { now: () => Date.now() } }'
    })

    const plain = original.toPlainObject()
    expect(plain['server']).toBe(true)
    expect(plain['schema']).toBe('type Query {\n  pets: [String!]!\n}')
    expect(plain['mockResolvers']).toBe('{ "Query.pets": ["Rex", "Whiskers"] }')
    expect(plain['resolverScript']).toBe('return { Query: { now: () => Date.now() } }')

    const restored = GraphQLRequest.fromPlain(plain as Parameters<typeof GraphQLRequest.fromPlain>[0])
    expect(restored.server).toBe(true)
    expect(restored.url).toBe('localhost:4000/graphql')
    expect(restored.schema).toBe(original.schema)
    expect(restored.mockResolvers).toBe(original.mockResolvers)
    expect(restored.resolverScript).toBe(original.resolverScript)
  })

  it('omits the server config from the plain object when the request is a client', () => {
    const client = new GraphQLRequest({ id: 'gql-2', name: 'Query', url: 'https://api.example.com/graphql' })
    const plain = client.toPlainObject()
    expect('server' in plain).toBe(false)
    expect('schema' in plain).toBe(false)
    expect('mockResolvers' in plain).toBe(false)
    expect('resolverScript' in plain).toBe(false)
  })
})

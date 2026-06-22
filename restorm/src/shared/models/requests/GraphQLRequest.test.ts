import { describe, it, expect } from 'vitest'
import { GraphQLRequest } from './GraphQLRequest'
import { KeyValue } from '../KeyValue'

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

/**
 * `operationName` selects which operation to run when a GraphQL document
 * declares more than one named operation. It must round-trip through
 * `toPlainObject` → `fromPlain` so the user's choice survives a
 * save/reload from disk.
 */
describe('GraphQLRequest — operationName persistence round-trip', () => {
  it('round-trips operationName alongside query/variables/headers', () => {
    const original = new GraphQLRequest({
      id: 'gql1',
      name: 'Multi-op',
      url: 'https://example.com/graphql',
      query: 'query A { a } query B { b }',
      variables: '{"id":1}',
      operationName: 'B',
      headers: [KeyValue.fromPlain({ key: 'X-Test', value: '1', enabled: true })]
    })

    const plain = original.toPlainObject()
    expect(plain.operationName).toBe('B')

    const restored = GraphQLRequest.fromPlain(
      plain as unknown as Parameters<typeof GraphQLRequest.fromPlain>[0]
    )
    expect(restored.operationName).toBe('B')
    expect(restored.query).toBe('query A { a } query B { b }')
    expect(restored.variables).toBe('{"id":1}')
    expect(restored.headers).toHaveLength(1)
  })

  it('omits operationName from the plain object when unset (single-operation document)', () => {
    const original = new GraphQLRequest({
      id: 'gql2',
      name: 'Single-op',
      url: 'https://example.com/graphql',
      query: 'query Only { x }'
    })

    const plain = original.toPlainObject()
    expect('operationName' in plain).toBe(false)

    const restored = GraphQLRequest.fromPlain(
      plain as unknown as Parameters<typeof GraphQLRequest.fromPlain>[0]
    )
    expect(restored.operationName).toBeUndefined()
  })
})

describe('GraphQLRequest subscription-client persistence', () => {
  it('round-trips a subscription operation (operationType + query + variables) through toPlainObject / fromPlain', () => {
    const original = new GraphQLRequest({
      id: 'gql-sub-1',
      name: 'Live ticks',
      url: 'http://localhost:4222/graphql',
      operationType: 'subscription',
      query: 'subscription OnTick { ticks }',
      variables: '{ "channel": "main" }'
    })

    const plain = original.toPlainObject()
    expect(plain['operationType']).toBe('subscription')
    expect(plain['query']).toBe('subscription OnTick { ticks }')
    expect(plain['variables']).toBe('{ "channel": "main" }')

    const restored = GraphQLRequest.fromPlain(plain as Parameters<typeof GraphQLRequest.fromPlain>[0])
    expect(restored.operationType).toBe('subscription')
    expect(restored.query).toBe('subscription OnTick { ticks }')
    expect(restored.variables).toBe('{ "channel": "main" }')
    // A subscription client never carries the server-hosting config.
    expect(restored.server).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { parseGraphQLOperations, parseGraphQLOperationNames } from './graphqlOperations'

describe('parseGraphQLOperations', () => {
  it('returns an empty list for an empty document', () => {
    expect(parseGraphQLOperations('')).toEqual([])
  })

  it('parses a single named query', () => {
    const doc = `query GetUser { user { id name } }`
    expect(parseGraphQLOperations(doc)).toEqual([
      { operationType: 'query', name: 'GetUser' }
    ])
  })

  it('parses multiple named operations in source order', () => {
    const doc = `
      query GetUser($id: ID!) { user(id: $id) { id } }
      mutation UpdateUser($id: ID!, $name: String!) { updateUser(id: $id, name: $name) { id } }
      subscription OnUserChanged { userChanged { id } }
    `
    expect(parseGraphQLOperationNames(doc)).toEqual(['GetUser', 'UpdateUser', 'OnUserChanged'])
    expect(parseGraphQLOperations(doc)).toEqual([
      { operationType: 'query', name: 'GetUser' },
      { operationType: 'mutation', name: 'UpdateUser' },
      { operationType: 'subscription', name: 'OnUserChanged' }
    ])
  })

  it('skips anonymous operations (shorthand and unnamed query)', () => {
    expect(parseGraphQLOperationNames(`{ me { id } }`)).toEqual([])
    expect(parseGraphQLOperationNames(`query { me { id } }`)).toEqual([])
  })

  it('does not match operation keywords appearing inside string literals', () => {
    const doc = `query Real { field(note: "query Fake { x }") }`
    expect(parseGraphQLOperationNames(doc)).toEqual(['Real'])
  })

  it('does not match operation keywords inside block strings', () => {
    const doc = `
      query Real {
        field(doc: """
          mutation Fake { y }
        """)
      }
    `
    expect(parseGraphQLOperationNames(doc)).toEqual(['Real'])
  })

  it('does not match operation keywords inside comments', () => {
    const doc = `
      # mutation Commented { z }
      query Real { id }
    `
    expect(parseGraphQLOperationNames(doc)).toEqual(['Real'])
  })

  it('does not treat a field named like a keyword as an operation', () => {
    const doc = `query Outer { subscription { id } }`
    expect(parseGraphQLOperationNames(doc)).toEqual(['Outer'])
  })
})

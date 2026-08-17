/**
 * GraphQL projection — SDL emission, resolver serving and the
 * round-trip guarantee: the emitted SDL must build into an executable
 * schema (graphql-yoga `createSchema`, the engine that serves it) AND
 * survive the app's own GraphQL importer.
 */

import { describe, it, expect } from 'vitest'
import { createSchema, createYoga } from 'electron-core-ui/main'
import {
  designGraphqlNames,
  designGraphqlOperations,
  designGraphqlResolvers,
  designToGraphqlSdl,
  sanitizeGraphqlName
} from '../../src/shared/design/graphqlProjection'
import { importGraphQL } from '../../src/main/services/import/GraphQLImportService'
import { buildReferenceApiDesign } from './apiDesignReference'

/** Execute one operation against the projected schema through the yoga
 * fetch adapter (restorm has no direct `graphql` dependency). */
async function execute(source: string): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }> {
  const design = buildReferenceApiDesign()
  const yoga = createYoga({
    schema: createSchema({ typeDefs: designToGraphqlSdl(design), resolvers: designGraphqlResolvers(design) }),
    graphqlEndpoint: '/graphql',
    landingPage: false
  })
  const response = await yoga.fetch('http://design/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source })
  })
  return await response.json() as { data?: Record<string, unknown>; errors?: unknown[] }
}

describe('designToGraphqlSdl', () => {
  const design = buildReferenceApiDesign()
  const sdl = designToGraphqlSdl(design)

  it('matches the golden SDL', async () => {
    await expect(sdl).toMatchFileSnapshot('./goldens/petstore.schema.graphql')
  })

  it('emits enums, object types and both operation roots', () => {
    expect(sdl).toContain('enum UserStatus {')
    expect(sdl).toContain('type User {')
    expect(sdl).toContain('type AdminUser {')
    expect(sdl).toContain('type Query {')
    expect(sdl).toContain('type Mutation {')
    // The list query paginates, the single query keys on the path param.
    expect(sdl).toMatch(/userList\(limit: Int, offset: Int\): \[User!\]!/)
    expect(sdl).toMatch(/getUser\(id: ID!\): User/)
  })

  it('builds into an executable schema and answers introspection', async () => {
    const result = await execute('{ __type(name: "User") { name fields { name } } }')
    expect(result.errors).toBeUndefined()
    const type = (result.data as { __type: { name: string; fields: { name: string }[] } }).__type
    expect(type.name).toBe('User')
    expect(type.fields.map((f) => f.name)).toContain('email')
  })

  it('round-trips through the GraphQL importer', () => {
    const folder = importGraphQL(sdl, { name: 'Round trip' })
    expect(folder).toBeDefined()
    const flat = JSON.stringify(folder)
    expect(flat).toContain('getUser')
    expect(flat).toContain('postUser')
  })
})

describe('designGraphqlResolvers', () => {
  const design = buildReferenceApiDesign()
  const resolvers = designGraphqlResolvers(design)
  const query = resolvers['Query'] as Record<string, (parent: unknown, args: Record<string, unknown>) => unknown>
  const mutation = resolvers['Mutation'] as Record<string, (parent: unknown, args: Record<string, unknown>) => unknown>

  it('serves a bounded list page through the kernel', () => {
    const items = query['userList']?.(undefined, { limit: 2 }) as Record<string, unknown>[]
    expect(items).toHaveLength(2)
    // The first served row is the named example.
    expect(items[0]?.['email']).toBe('admin@example.com')
  })

  it('serves the named example when the identifier matches', () => {
    const listed = query['userList']?.(undefined, { limit: 1 }) as Record<string, unknown>[]
    const adminId = String(listed[0]?.['id'])
    const single = query['getUser']?.(undefined, { id: adminId }) as Record<string, unknown>
    expect(single['email']).toBe('admin@example.com')
  })

  it('echoes the mutation input over the served instance', () => {
    const created = mutation['postUser']?.(undefined, { input: { email: 'new@example.com' } }) as Record<string, unknown>
    expect(created['email']).toBe('new@example.com')
  })

  it('serves enum values in their sanitized GraphQL spelling', async () => {
    const result = await execute('{ userList(limit: 1) { status email } }')
    expect(result.errors).toBeUndefined()
    const rows = (result.data as { userList: Record<string, unknown>[] }).userList
    expect(rows[0]?.['email']).toBe('admin@example.com')
  })
})

describe('naming', () => {
  it('sanitizes arbitrary labels into valid GraphQL names', () => {
    expect(sanitizeGraphqlName('Order line-item', 'X')).toBe('Order_line_item')
    expect(sanitizeGraphqlName('42nd', 'X')).toBe('_42nd')
    expect(sanitizeGraphqlName('***', 'Fallback')).toBe('Fallback')
  })

  it('keeps type names collision-free', () => {
    const names = designGraphqlNames(buildReferenceApiDesign())
    const all = [...names.models.values(), ...names.enums.values()]
    expect(new Set(all).size).toBe(all.length)
  })

  it('derives one operation per bound route', () => {
    const operations = designGraphqlOperations(buildReferenceApiDesign())
    const fields = operations.map((o) => o.fieldName)
    expect(new Set(fields).size).toBe(fields.length)
    expect(operations.some((o) => o.kind === 'query' && o.list)).toBe(true)
    expect(operations.some((o) => o.kind === 'mutation')).toBe(true)
  })
})

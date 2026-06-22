import { describe, it, expect, vi } from 'vitest'

// Partial mock: keep every real ECUI/main export (createSchema / createYoga) and
// only silence the logger, which otherwise touches `electron.app.isPackaged`.
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return {
    ...actual,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }
})

import { createYoga } from 'electron-core-ui/main'
import { buildMockSchema, parseCannedResolvers, mergeResolvers } from './graphqlMockSchema'

/** Execute a GraphQL operation against a built mock schema through a real
 * graphql-yoga handler (a fetch `Request` → `Response`), so the test exercises
 * the same serve path the mock server uses — including introspection. */
async function runOperation(
  input: { schema?: string; mockResolvers?: string; resolverScript?: string },
  query: string
): Promise<{ data?: unknown; errors?: unknown }> {
  const schema = buildMockSchema(input)
  const yoga = createYoga({ schema, graphqlEndpoint: '/graphql', landingPage: false })
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  })
  return await response.json() as { data?: unknown; errors?: unknown }
}

describe('graphqlMockSchema — canned resolvers', () => {
  it('serves canned values for Query fields keyed by Type.field', async () => {
    const res = await runOperation(
      {
        schema: 'type Query {\n  pets: [String!]!\n  count: Int\n}',
        mockResolvers: '{ "Query.pets": ["Rex", "Whiskers"], "Query.count": 2 }'
      },
      '{ pets count }'
    )
    expect(res.errors).toBeUndefined()
    expect(res.data).toEqual({ pets: ['Rex', 'Whiskers'], count: 2 })
  })

  it('answers the default schema when no SDL is provided', async () => {
    const res = await runOperation({ mockResolvers: '{ "Query.hello": "hi" }' }, '{ hello }')
    expect(res.errors).toBeUndefined()
    expect(res.data).toEqual({ hello: 'hi' })
  })

  it('exposes introspection (__schema) so clients can explore the mock', async () => {
    const res = await runOperation(
      { schema: 'type Query {\n  pets: [String!]!\n}' },
      '{ __schema { queryType { name } } }'
    )
    expect(res.errors).toBeUndefined()
    const data = res.data as { __schema?: { queryType?: { name?: string } } }
    expect(data.__schema?.queryType?.name).toBe('Query')
  })

  it('ignores malformed mockResolvers JSON (serves schema defaults instead of throwing)', () => {
    expect(parseCannedResolvers('{ not json')).toEqual({})
  })
})

describe('graphqlMockSchema — scripted overrides', () => {
  it('lets a scripted resolver override a canned field', async () => {
    const res = await runOperation(
      {
        schema: 'type Query {\n  greeting: String\n}',
        mockResolvers: '{ "Query.greeting": "canned" }',
        resolverScript: 'return { Query: { greeting: () => "scripted" } }'
      },
      '{ greeting }'
    )
    expect(res.data).toEqual({ greeting: 'scripted' })
  })

  it('merges resolver maps with the scripted map winning per field', () => {
    const merged = mergeResolvers(
      { Query: { a: () => 1, b: () => 2 } },
      { Query: { b: () => 99 } }
    )
    const q = merged['Query'] as Record<string, () => number>
    expect(q['a']()).toBe(1)
    expect(q['b']()).toBe(99)
  })
})

describe('graphqlMockSchema — subscriptions (SSE)', () => {
  it('streams a subscription event a scripted resolver publishes to the injected pubsub', async () => {
    const { createPubSub } = await import('electron-core-ui/main')
    const pubsub = createPubSub<Record<string, [unknown]>>()
    const schema = buildMockSchema({
      schema: 'type Query {\n  _: Boolean\n}\ntype Subscription {\n  ticks: Int\n}',
      // The scripted resolver subscribes to the injected pubsub topic + maps each
      // published value onto the `ticks` field.
      resolverScript:
        'return { Subscription: { ticks: { subscribe: () => pubsub.subscribe("ticks"), resolve: (v) => v } } }',
      pubsub
    })
    const yoga = createYoga({ schema, graphqlEndpoint: '/graphql', landingPage: false })

    const response = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ query: 'subscription { ticks }' })
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    // Drain the SSE stream while RE-publishing on an interval — the first
    // publish can land before Yoga has finished subscribing the iterator, so a
    // single fire-then-read races. Re-firing until the value streams (bounded)
    // makes the assertion deterministic.
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    const ticker = setInterval(() => { pubsub.publish('ticks', 7) }, 100)
    let buf = ''
    const deadline = Date.now() + 8000
    try {
      while (Date.now() < deadline && !buf.includes('"ticks"')) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
      }
    } finally {
      clearInterval(ticker)
      await reader.cancel().catch(() => { /* stream already closing */ })
    }
    expect(buf).toContain('"ticks":7')
  }, 15000)
})

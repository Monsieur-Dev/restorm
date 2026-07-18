import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return {
    ...actual,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }
})

import { createYoga } from 'electron-core-ui/main'
import { buildMockSchema } from './graphqlMockSchema'

// The reference sample's exact resolver shape: an async generator that yields
// once then suspends forever, so the CLIENT owns the stop.
const SCRIPT = `return {
  Subscription: {
    ticks: {
      subscribe: async function* () {
        yield 42
        await new Promise(() => {})
      },
      resolve: (value) => value
    }
  }
}`

describe('scripted async-generator subscription lifetime', () => {
  it('emits the first event then STAYS OPEN (no instant complete)', async () => {
    const schema = buildMockSchema({
      schema: 'type Query {\n  _: Boolean\n}\ntype Subscription {\n  ticks: Int\n}',
      resolverScript: SCRIPT,
      pubsub: {}
    })
    const yoga = createYoga({ schema, graphqlEndpoint: '/graphql', landingPage: false })
    const response = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ query: 'subscription { ticks }' })
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let sawDone = false
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const race = await Promise.race([
        reader.read().then((r) => ({ kind: 'read' as const, r })),
        new Promise<{ kind: 'timeout' }>((resolve) => { setTimeout(() => { resolve({ kind: 'timeout' }) }, Math.max(1, deadline - Date.now())) })
      ])
      if (race.kind === 'timeout') break
      if (race.r.done) { sawDone = true; break }
      buf += decoder.decode(race.r.value, { stream: true })
      // A yoga SSE stream signals termination with a `complete` event before EOF.
      if (buf.includes('event: complete')) { sawDone = true; break }
    }
    await reader.cancel().catch(() => { /* closing */ })

    expect(buf).toContain('"ticks":42')
    // The whole bug: the stream must NOT have completed on its own.
    expect(sawDone).toBe(false)
  }, 15000)
})

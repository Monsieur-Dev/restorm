// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  httpExecuteArgs,
  odataExecuteArgs,
  authPrefetchArgs,
  graphqlExecuteArgs,
  collectionsSyncArgs
} from './schemas'

// Dropping `.loose()` makes zod's default object behaviour STRIP unknown
// keys (parse succeeds, the extra field is removed) — which is the #22
// goal: an arbitrary renderer-supplied field never reaches the executor.
describe('execute-args schemas — tightened (no more .loose())', () => {
  it('httpExecuteArgs accepts the real fields incl. authRequest/rawBody/urlOverride', () => {
    const r = httpExecuteArgs.safeParse([{
      requestId: 'r1', method: 'POST', timeout: 5000,
      rawBody: '{}', rawBodyContentType: 'application/json', urlOverride: 'https://x/y',
      authRequest: { type: 'auth', producedHeaders: [] }
    }])
    expect(r.success).toBe(true)
    expect(r.success && (r.data[0] as { authRequest?: unknown }).authRequest).toBeDefined()
  })

  it('httpExecuteArgs STRIPS an unknown field (was passed through by .loose())', () => {
    const r = httpExecuteArgs.safeParse([{ requestId: 'r1', method: 'GET', bogusInjectedField: 'x' }])
    expect(r.success).toBe(true)
    expect(r.success && 'bogusInjectedField' in r.data[0]).toBe(false)
  })

  it('httpExecuteArgs rejects a missing requestId', () => {
    expect(httpExecuteArgs.safeParse([{ method: 'GET' }]).success).toBe(false)
  })

  it('odataExecuteArgs keeps its fields and strips an unknown one', () => {
    const r = odataExecuteArgs.safeParse([{ requestId: 'r', method: 'GET', urlOverride: 'https://x', authRequest: {}, sneaky: 1 }])
    expect(r.success).toBe(true)
    expect(r.success && 'sneaky' in r.data[0]).toBe(false)
    expect(r.success && (r.data[0] as { urlOverride?: string }).urlOverride).toBe('https://x')
  })

  it('authPrefetchArgs accepts a valid spec and strips an unknown field', () => {
    const r = authPrefetchArgs.safeParse([{ method: 'POST', url: 'https://x/token', producedHeaders: [], extra: true }])
    expect(r.success).toBe(true)
    expect(r.success && 'extra' in r.data[0]).toBe(false)
  })

  it('graphqlExecuteArgs strips an unknown field', () => {
    const r = graphqlExecuteArgs.safeParse([{ requestId: 'r', timeout: 1, injected: 'y' }])
    expect(r.success).toBe(true)
    expect(r.success && 'injected' in r.data[0]).toBe(false)
  })
})

describe('collectionsSyncArgs — node shape validation (#21)', () => {
  it('accepts objects carrying a string id (extra fields pass through via loose)', () => {
    const r = collectionsSyncArgs.safeParse([[{ id: 'f1', name: 'F', items: [] }, { id: 'r1', type: 'http' }]])
    expect(r.success).toBe(true)
  })

  it('rejects primitives / null / id-less entries (was bare z.unknown())', () => {
    expect(collectionsSyncArgs.safeParse([['not-an-object']]).success).toBe(false)
    expect(collectionsSyncArgs.safeParse([[null]]).success).toBe(false)
    expect(collectionsSyncArgs.safeParse([[{ name: 'no id' }]]).success).toBe(false)
  })

  it('accepts an empty collection array', () => {
    expect(collectionsSyncArgs.safeParse([[]]).success).toBe(true)
  })
})

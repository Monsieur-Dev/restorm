import { describe, it, expect, beforeEach } from 'vitest'
import { SecretHydrationService } from './SecretHydrationService'
import type { ValueSourceResolver } from '../../../shared/secrets/ValueSource'
import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolver(id: string, returnValue: unknown): ValueSourceResolver & { callCount: number } {
  const resolver = {
    id,
    callCount: 0,
    read(_params: Record<string, unknown>, _ctx: { scopeId: string; signal?: AbortSignal }) {
      resolver.callCount++
      return Promise.resolve(returnValue)
    }
  }
  return resolver
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecretHydrationService', () => {
  let resolver: ReturnType<typeof makeResolver>
  let getResolver: (id: string) => ValueSourceResolver | undefined
  let svc: SecretHydrationService

  beforeEach(() => {
    resolver = makeResolver('env', 'secret-value')
    getResolver = (id) => (id === 'env' ? resolver : undefined)
    svc = new SecretHydrationService(getResolver)
  })

  // -------------------------------------------------------------------------
  // 1. Basic resolution
  // -------------------------------------------------------------------------
  it('resolves a SecretValue and sets .resolved', async () => {
    const sv = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-1', [sv])
    expect(sv.resolved).toBe('secret-value')
  })

  it('shares ONE provider call across concurrent resolutions of the same credential (different scopes)', async () => {
    // Deferred resolver: completes only when released, so the two hydrate calls
    // genuinely overlap (the env-folder scope AND the cell 'preview' scope) before
    // either finishes — the case that double-fetched a slow secret on file open.
    let release: (v: unknown) => void = () => undefined
    const deferred = {
      id: 'env',
      callCount: 0,
      read(_p: Record<string, unknown>, _ctx: { scopeId: string; signal?: AbortSignal }): Promise<unknown> {
        deferred.callCount++
        return new Promise<unknown>((res) => { release = res })
      }
    }
    const s = new SecretHydrationService((id) => (id === 'env' ? deferred : undefined))
    const a = new SecretValue('env', { name: 'X' })
    const b = new SecretValue('env', { name: 'X' })
    const p1 = s.hydrate('scope-a', [a])
    const p2 = s.hydrate('scope-b', [b])
    release('shared-value')
    await Promise.all([p1, p2])
    expect(deferred.callCount).toBe(1)
    expect(a.resolved).toBe('shared-value')
    expect(b.resolved).toBe('shared-value')
  })

  // -------------------------------------------------------------------------
  // 2. Cache: same source+params in same scope → resolver called once
  // -------------------------------------------------------------------------
  it('calls resolver only once for two SecretValues with identical source+params', async () => {
    const sv1 = new SecretValue('env', { name: 'API_KEY' })
    const sv2 = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-1', [sv1, sv2])
    expect(resolver.callCount).toBe(1)
    expect(sv1.resolved).toBe('secret-value')
    expect(sv2.resolved).toBe('secret-value')
  })

  // -------------------------------------------------------------------------
  // 3. Object payload + sub-key extraction via params.path
  // -------------------------------------------------------------------------
  it('extracts nested sub-key from an object payload', async () => {
    const objectResolver = makeResolver('obj', { a: { b: 'X' } })
    const svc2 = new SecretHydrationService((id) => (id === 'obj' ? objectResolver : undefined))
    const sv = new SecretValue('obj', { path: 'a.b' })
    await svc2.hydrate('scope-1', [sv])
    expect(sv.resolved).toBe('X')
  })

  // -------------------------------------------------------------------------
  // 4. invalidate removes the cache entry → next hydrate re-fetches
  // -------------------------------------------------------------------------
  it('invalidate causes next hydrate to call resolver again', async () => {
    const sv1 = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-1', [sv1])
    expect(resolver.callCount).toBe(1)

    svc.invalidate('scope-1', 'env', { name: 'API_KEY' })

    const sv2 = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-1', [sv2])
    expect(resolver.callCount).toBe(2)
  })

  // -------------------------------------------------------------------------
  // 5a. clearScope drops entries for that scope only
  // -------------------------------------------------------------------------
  it('clearScope removes entries for the given scope', async () => {
    const sv1 = new SecretValue('env', { name: 'API_KEY' })
    const sv2 = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-A', [sv1])
    await svc.hydrate('scope-B', [sv2])
    expect(resolver.callCount).toBe(2) // different scopes, each fetched once

    svc.clearScope('scope-A')

    // scope-A must re-fetch
    const sv3 = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-A', [sv3])
    expect(resolver.callCount).toBe(3)

    // scope-B still cached
    const sv4 = new SecretValue('env', { name: 'API_KEY' })
    await svc.hydrate('scope-B', [sv4])
    expect(resolver.callCount).toBe(3)
  })

  // -------------------------------------------------------------------------
  // 5b. clearAll drops all entries
  // -------------------------------------------------------------------------
  it('clearAll removes all cached entries', async () => {
    const sv1 = new SecretValue('env', { name: 'A' })
    const sv2 = new SecretValue('env', { name: 'B' })
    await svc.hydrate('scope-X', [sv1])
    await svc.hydrate('scope-Y', [sv2])
    expect(resolver.callCount).toBe(2)

    svc.clearAll()

    const sv3 = new SecretValue('env', { name: 'A' })
    const sv4 = new SecretValue('env', { name: 'B' })
    await svc.hydrate('scope-X', [sv3])
    await svc.hydrate('scope-Y', [sv4])
    expect(resolver.callCount).toBe(4)
  })

  // -------------------------------------------------------------------------
  // 5c. params differing ONLY in a nested field do NOT collide
  // -------------------------------------------------------------------------
  it('does not collide for params differing only in a nested field', async () => {
    let count = 0
    const distinctResolver: ValueSourceResolver = {
      id: 'env',
      read(params: Record<string, unknown>) {
        count++
        // Echo the nested value so we can prove each got its own resolution.
        const nested = (params.opts as { region?: string } | undefined)?.region
        return Promise.resolve(`value-${nested}`)
      }
    }
    const svcNested = new SecretHydrationService((id) => (id === 'env' ? distinctResolver : undefined))

    const sv1 = new SecretValue('env', { name: 'API_KEY', opts: { region: 'eu' } })
    const sv2 = new SecretValue('env', { name: 'API_KEY', opts: { region: 'us' } })
    await svcNested.hydrate('scope-1', [sv1, sv2])

    expect(count).toBe(2)
    expect(sv1.resolved).toBe('value-eu')
    expect(sv2.resolved).toBe('value-us')
  })

  // -------------------------------------------------------------------------
  // 6. Unknown source → throws
  // -------------------------------------------------------------------------
  it('throws for an unknown secret source', async () => {
    const sv = new SecretValue('unknown-source', { name: 'X' })
    await expect(svc.hydrate('scope-1', [sv])).rejects.toThrow(
      'unknown secret source: unknown-source'
    )
  })
})

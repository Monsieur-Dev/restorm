// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { makeGuardedFetch } from './guardedFetch'

const HOST = 'ntxmtfngtfevisbylniz.supabase.co'

/** Inline replica of `isBackendFunctionsUrl` for test use — pins the exact
 * backend host + /functions/v1/ prefix, matching the predicate a host app would
 * inject into `makeGuardedFetch`. */
function isBackendFunctionsUrl(rawUrl: string, allowedHost: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && url.host === allowedHost && url.pathname.startsWith('/functions/v1/')
  } catch {
    return false
  }
}

interface Captured { url: string; init?: RequestInit; bypassed: boolean }

interface Harness {
  fetch: typeof fetch
  calls: Captured[]
  counters: { bypass: number }
}

/** Build a guarded fetch over a stub base-fetch that records what it saw and
 * whether it ran inside the (fake) bypass scope. */
function harness(): Harness {
  const calls: Captured[] = []
  const counters = { bypass: 0 }
  let inBypass = false
  const bypass = async <T>(fn: () => Promise<T>): Promise<T> => {
    counters.bypass += 1
    inBypass = true
    try {
      return await fn()
    } finally {
      inBypass = false
    }
  }
  const baseFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, bypassed: inBypass, ...(init !== undefined ? { init } : {}) })
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as unknown as typeof fetch

  return {
    fetch: makeGuardedFetch({ isEligibleUrl: (url) => isBackendFunctionsUrl(url, HOST), bypass, baseFetch }),
    calls,
    counters
  }
}

describe('makeGuardedFetch', () => {
  it('bypasses + forces manual redirect ONLY for the exact backend host', async () => {
    const h = harness()
    await h.fetch(`https://${HOST}/functions/v1/entitlement`, { method: 'GET', headers: { authorization: 'Bearer x' } })
    expect(h.calls).toHaveLength(1)
    const c0 = h.calls.at(0)
    expect(c0?.bypassed).toBe(true)
    expect(c0?.init?.redirect).toBe('manual')
    // preserves the caller's options
    expect(c0?.init?.method).toBe('GET')
  })

  it('does NOT bypass a different *.supabase.co host (passthrough, no manual redirect)', async () => {
    const h = harness()
    await h.fetch('https://other-project.supabase.co/functions/v1/login', { method: 'POST' })
    const c0 = h.calls.at(0)
    expect(c0?.bypassed).toBe(false)
    expect(c0?.init?.redirect).toBeUndefined()
    expect(h.counters.bypass).toBe(0)
  })

  it('does NOT bypass http / non-functions paths on the right host', async () => {
    const h = harness()
    await h.fetch(`http://${HOST}/functions/v1/login`)
    await h.fetch(`https://${HOST}/rest/v1/users`)
    expect(h.calls.every((c) => !c.bypassed)).toBe(true)
    expect(h.counters.bypass).toBe(0)
  })

  it('passes a URL object input through the same guard', async () => {
    const h = harness()
    await h.fetch(new URL(`https://${HOST}/functions/v1/session`), { method: 'POST' })
    const c0 = h.calls.at(0)
    expect(c0?.bypassed).toBe(true)
    expect(c0?.init?.redirect).toBe('manual')
  })
})

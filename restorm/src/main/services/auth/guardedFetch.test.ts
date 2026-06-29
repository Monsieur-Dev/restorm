// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { makeGuardedFetch } from './guardedFetch'

const HOST = 'ntxmtfngtfevisbylniz.supabase.co'

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
    calls.push({ url, init, bypassed: inBypass })
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as unknown as typeof fetch

  return { fetch: makeGuardedFetch({ allowedHost: HOST, bypass, baseFetch }), calls, counters }
}

describe('makeGuardedFetch', () => {
  it('bypasses + forces manual redirect ONLY for the exact backend host', async () => {
    const h = harness()
    await h.fetch(`https://${HOST}/functions/v1/entitlement`, { method: 'GET', headers: { authorization: 'Bearer x' } })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].bypassed).toBe(true)
    expect(h.calls[0].init?.redirect).toBe('manual')
    // preserves the caller's options
    expect(h.calls[0].init?.method).toBe('GET')
  })

  it('does NOT bypass a different *.supabase.co host (passthrough, no manual redirect)', async () => {
    const h = harness()
    await h.fetch('https://other-project.supabase.co/functions/v1/login', { method: 'POST' })
    expect(h.calls[0].bypassed).toBe(false)
    expect(h.calls[0].init?.redirect).toBeUndefined()
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
    expect(h.calls[0].bypassed).toBe(true)
    expect(h.calls[0].init?.redirect).toBe('manual')
  })
})

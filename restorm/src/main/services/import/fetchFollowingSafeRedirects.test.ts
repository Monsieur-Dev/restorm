import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the ECUI logger so importing ImportManager doesn't need the Electron
// runtime. assertSafeFetchUrl stays REAL — it's the per-hop guard under test.
vi.mock('electron-core-ui/main', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('electron-core-ui', () => ({ withFirewallBypass: <T>(fn: () => T): T => fn() }))

import { fetchFollowingSafeRedirects } from './ImportManager'

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}
function ok(body = '{}'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('fetchFollowingSafeRedirects — per-hop SSRF re-check (strict)', () => {
  const realFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('follows a public→public redirect and returns the final response', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://cdn.example.com/spec.json'))
      .mockResolvedValueOnce(ok('{"openapi":"3.0.0"}'))
    const res = await fetchFollowingSafeRedirects('https://example.com/spec', {})
    expect(res.status).toBe(200)
    // Every hop dispatched with redirect:'manual' so WE re-check, not undici.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('BLOCKS a redirect that pivots from a public URL to an internal host', async () => {
    // The classic SSRF: public entry point 302s to the cloud metadata IP.
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/'))
    await expect(fetchFollowingSafeRedirects('https://example.com/spec', {}))
      .rejects.toThrow(/link-local|metadata/)
    // We never dispatched the second (internal) fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('BLOCKS a redirect to a private/loopback host (strict per-hop, no allowPrivateHosts)', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://127.0.0.1:9000/admin'))
    await expect(fetchFollowingSafeRedirects('https://example.com/spec', {}))
      .rejects.toThrow(/private|loopback/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a non-redirect response directly', async () => {
    fetchMock.mockResolvedValueOnce(ok())
    const res = await fetchFollowingSafeRedirects('https://example.com/spec', {})
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps the redirect chain', async () => {
    fetchMock.mockResolvedValue(redirect('https://example.com/again'))
    await expect(fetchFollowingSafeRedirects('https://example.com/spec', {}))
      .rejects.toThrow(/Too many redirects/)
  })
})

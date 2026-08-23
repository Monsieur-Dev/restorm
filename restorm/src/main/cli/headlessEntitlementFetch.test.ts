// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateEdKeyPair, signEntitlement } from 'electron-core-ui/main'
import { checkHeadlessEntitlement, ENTITLEMENT_AUDIENCE, type HeadlessEntitlementDeps } from './headlessEntitlementFetch'

/**
 * Fixed "current time" for all tests: 1 000 000 epoch-seconds (ms for `now()`).
 * The entitlement JWT uses iat/exp/refreshAfter in epoch-SECONDS; jose's
 * `currentDate` is a `Date` constructed from epoch-ms. So:
 *   - JWT iat = NOW_S, exp = NOW_S + graceSeconds (default 15 d)
 *   - deps.now = () => NOW_MS  →  currentDate = new Date(NOW_MS) = correct
 */
const NOW_S = 1_000_000
const NOW_MS = NOW_S * 1000

/** Build a fetch stub that resolves to a fake entitlement response. */
function fetchReturning(jwt: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ entitlement: jwt })
  } as Response) as unknown as typeof fetch
}

/** Build a fetch stub that rejects (network error). */
function fetchFailing(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch
}

/** Build a fetch stub that returns a non-2xx (e.g. 401 revoked). */
function fetchHttp401(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({})
  } as Response) as unknown as typeof fetch
}

describe('checkHeadlessEntitlement', () => {
  afterEach(() => {
    delete process.env['RESTORM_TOKEN']
  })

  it('returns token-missing when RESTORM_TOKEN is not set', async () => {
    delete process.env['RESTORM_TOKEN']
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE, privateKey, iatSeconds: NOW_S, capabilities: ['scenario.headless'] })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-missing' })
  })

  it('returns token-missing when RESTORM_TOKEN is blank', async () => {
    process.env['RESTORM_TOKEN'] = '   '
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE, privateKey, iatSeconds: NOW_S, capabilities: ['scenario.headless'] })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-missing' })
  })

  it('grants when token is valid and plan includes scenario.headless', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_valid'
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE,
      privateKey,
      iatSeconds: NOW_S,
      plan: 'pro',
      capabilities: ['scenario.headless', 'mcp.pro']
    })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: true })
  })

  it('grants for enterprise plan too', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_enterprise'
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE,
      privateKey,
      iatSeconds: NOW_S,
      plan: 'enterprise',
      capabilities: ['scenario.headless', 'mcp.pro', 'team.seats']
    })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: true })
  })

  it('returns plan-insufficient when token is valid but plan lacks scenario.headless', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_community'
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE,
      privateKey,
      iatSeconds: NOW_S,
      plan: 'community',
      capabilities: []
    })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'plan-insufficient' })
  })

  it('returns fetch-error on a network failure', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_valid'
    const { publicSpkiPem } = await generateEdKeyPair()
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchFailing(),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'fetch-error' })
  })

  it('tells a REJECTED token apart from an unreachable endpoint (401 vs transport)', async () => {
    // The distinction earns its keep now that tokens can expire: a 401 is
    // permanent, and reporting it as a network problem sends a CI owner
    // debugging their egress rules for a token that simply ran out.
    process.env['RESTORM_TOKEN'] = 'rstk_revoked'
    const { publicSpkiPem } = await generateEdKeyPair()
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchHttp401(),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-rejected' })
  })

  it('returns token-invalid when the backend returns a malformed JWT', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_valid'
    const { publicSpkiPem } = await generateEdKeyPair()
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning('not.a.valid.jwt.at.all'),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-invalid' })
  })

  it('returns token-invalid when the JWT is signed with a different key (forged)', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_forged'
    const { privateKey: attackerKey } = await generateEdKeyPair()
    const { publicSpkiPem: trustedKey } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE,
      privateKey: attackerKey,
      iatSeconds: NOW_S,
      plan: 'pro',
      capabilities: ['scenario.headless']
    })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: trustedKey,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-invalid' })
  })

  it('returns token-invalid when the JWT is expired', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_expired'
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    // graceSeconds: 1 → exp = NOW_S + 1; current clock = NOW_S + 2 → expired
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE,
      privateKey,
      iatSeconds: NOW_S,
      graceSeconds: 1,
      capabilities: ['scenario.headless']
    })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: true,
      fetchImpl: fetchReturning(jwt),
      now: () => (NOW_S + 2) * 1000
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-invalid' })
  })

  it('returns token-invalid when publicKeyConfigured is false (prod pre-launch)', async () => {
    process.env['RESTORM_TOKEN'] = 'rstk_valid'
    const { privateKey, publicSpkiPem } = await generateEdKeyPair()
    const jwt = await signEntitlement({ audience: ENTITLEMENT_AUDIENCE, privateKey, iatSeconds: NOW_S, capabilities: ['scenario.headless'] })
    const deps: HeadlessEntitlementDeps = {
      entitlementUrl: 'https://example.com/entitlement',
      publicKeyPem: publicSpkiPem,
      publicKeyConfigured: false,
      fetchImpl: fetchReturning(jwt),
      now: () => NOW_MS
    }
    expect(await checkHeadlessEntitlement(deps)).toEqual({ granted: false, reason: 'token-invalid' })
  })
})

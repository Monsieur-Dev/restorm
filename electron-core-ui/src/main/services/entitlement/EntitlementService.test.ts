// @vitest-environment node
import { describe, it, expect, beforeAll, vi, type Mock } from 'vitest'
import { EntitlementService, seedEntitlementForE2E, type EntitlementServiceDeps } from './EntitlementService'
import { generateEdKeyPair, signEntitlement, signSession, type EdKeyPair, ENTITLEMENT_AUD, SESSION_AUD } from './entitlementTestKit'
import type { AuthState } from '../../../shared/auth/authState'

const IAT = 1_700_000_000
const SESSION_SECRET = 'test-session-secret-at-least-32-bytes-long!!'
const at = (secondsAfterIat: number): (() => number) => () => (IAT + secondsAfterIat) * 1000

let keys: EdKeyPair
beforeAll(async () => { keys = await generateEdKeyPair() })

interface Persisted { sessionToken: string; entitlementToken: string | null }

/** Last element, narrowed to the element type (throws if empty) — keeps `expect`
 * off the `T | undefined` overload that the lint flags as unresolved. */
function last<T>(arr: T[]): T {
  const value = arr[arr.length - 1]
  if (value === undefined) throw new Error('expected a non-empty array')
  return value
}

interface Harness {
  service: EntitlementService
  broadcasts: AuthState[]
  saved: Persisted[]
  counters: { cleared: number }
  fetchMock: Mock<() => Promise<Response>>
  loginMock: Mock<(signal?: AbortSignal) => Promise<string>>
}

function makeHarness(opts: {
  now?: () => number
  initialCache?: Persisted | null
  sessionToken?: string
  entitlementToken?: string
  fetchRejects?: boolean
  /** Share ONE mutable cache slot between several harnesses — the shape of two
   * instances reading and writing the same `auth-session.dat`. */
  sharedCache?: { value: Persisted | null }
} = {}): Harness {
  const broadcasts: AuthState[] = []
  const saved: Persisted[] = []
  const counters = { cleared: 0 }
  const slot = opts.sharedCache ?? { value: opts.initialCache ?? null }

  const fetchMock = vi.fn((): Promise<Response> => {
    if (opts.fetchRejects) return Promise.reject(new Error('offline'))
    return Promise.resolve(new Response(JSON.stringify({ entitlement: opts.entitlementToken ?? '' }), { status: 200 }))
  })
  const loginMock = vi.fn((_signal?: AbortSignal): Promise<string> => Promise.resolve(opts.sessionToken ?? 'unused'))

  const deps: EntitlementServiceDeps = {
    store: {
      load: () => slot.value,
      save: (d) => { saved.push(d); slot.value = d },
      clear: () => { counters.cleared += 1; slot.value = null }
    },
    entitlementUrl: 'https://x.supabase.co/functions/v1/entitlement',
    checkoutUrl: 'https://x.supabase.co/functions/v1/checkout',
    portalUrl: 'https://x.supabase.co/functions/v1/customer-portal',
    publicKeyPem: keys.publicSpkiPem,
    entitlementAudience: ENTITLEMENT_AUD,
    sessionAudience: SESSION_AUD,
    fetchImpl: fetchMock as unknown as typeof fetch,
    login: loginMock,
    broadcast: (_channel, state) => { broadcasts.push(state) },
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    log: () => undefined
  }
  const service = new EntitlementService(deps)
  return { service, broadcasts, saved, counters, fetchMock, loginMock }
}

describe('EntitlementService — sign in / out', () => {
  it('signIn drives login, fetches + verifies the entitlement, flips state to pro, and broadcasts', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.stepDebug', 'secrets.vaults']
    })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })

    const state = await h.service.signIn()

    expect(h.loginMock.mock.calls.length).toBe(1)
    expect(state.signedIn).toBe(true)
    expect(state.user?.email).toBe('a@b.com')
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toEqual(['scenario.stepDebug', 'secrets.vaults'])
    // Broadcast at least once with the signed-in pro state.
    expect(last(h.broadcasts)).toMatchObject({ signedIn: true, plan: 'pro' })
    // Persisted the session + entitlement token.
    expect(last(h.saved)).toEqual({ sessionToken, entitlementToken })
  })

  it('flows the session name + photoUrl into the avatar-facing user profile', async () => {
    const sessionToken = await signSession({
      secret: SESSION_SECRET,
      email: 'a@b.com',
      name: 'Ada Lovelace',
      photoUrl: 'https://lh3.googleusercontent.com/a/ada',
      iatSeconds: IAT
    })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })

    const state = await h.service.signIn()

    expect(state.user?.name).toBe('Ada Lovelace')
    expect(state.user?.photoUrl).toBe('https://lh3.googleusercontent.com/a/ada')
  })

  it('omits name + photoUrl when the session carries none (clean fallback to initials)', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })

    const state = await h.service.signIn()

    expect(state.user?.email).toBe('a@b.com')
    expect(state.user?.name).toBeUndefined()
    expect(state.user?.photoUrl).toBeUndefined()
  })

  it('signOut clears the cache, resets to community, and broadcasts signed-out', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()
    h.broadcasts.length = 0

    h.service.signOut()

    const state = h.service.getState()
    expect(state.signedIn).toBe(false)
    expect(state.plan).toBe('community')
    expect(state.capabilities).toEqual([])
    expect(last(h.broadcasts)).toMatchObject({ signedIn: false, plan: 'community' })
  })

  it('restartable: a second signIn supersedes the in-flight attempt and relaunches login', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })

    const first = h.service.signIn()
    const second = h.service.signIn()
    // The superseded attempt resolves (does NOT throw) so a fire-and-forget
    // renderer caller never sees an unhandled rejection; the fresh attempt owns
    // the outcome.
    const [, secondState] = await Promise.all([first, second])

    // login() ran twice — the first was cancelled + relaunched, not coalesced.
    expect(h.loginMock.mock.calls.length).toBe(2)
    expect(secondState.signedIn).toBe(true)
    expect(h.service.getState().signedIn).toBe(true)
  })

  it('the in-flight login receives an AbortSignal it can honour for cancellation', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()
    const firstArg = h.loginMock.mock.calls[0]?.[0] as unknown
    expect(firstArg).toBeInstanceOf(AbortSignal)
  })
})

describe('EntitlementService — init from cache + offline grace', () => {
  it('restores a cached session + entitlement within grace (pro, no network needed)', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'c@d.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.headless']
    })
    // now = iat + 12h: within grace AND before refreshAfter (24h) → no refresh poll.
    const h = makeHarness({
      now: at(60 * 60 * 12),
      initialCache: { sessionToken, entitlementToken }
    })

    await h.service.init()

    const state = h.service.getState()
    expect(state.signedIn).toBe(true)
    expect(state.user?.email).toBe('c@d.com')
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toEqual(['scenario.headless'])
    expect(h.fetchMock.mock.calls.length).toBe(0)
  })

  it('drops an expired session on init (past 30d) and stays signed out', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT, ttlSeconds: 100 })
    const h = makeHarness({
      now: at(1000), // past the 100s session ttl
      initialCache: { sessionToken, entitlementToken: null }
    })
    await h.service.init()
    expect(h.service.getState().signedIn).toBe(false)
    expect(h.counters.cleared).toBeGreaterThan(0)
  })

  it('treats a cached entitlement past its grace ceiling as community (signed in, no caps)', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      graceSeconds: 100,
      plan: 'pro'
    })
    // now past the entitlement grace ceiling but within the session ttl; fetch
    // rejects (offline) so no fresh entitlement → community.
    const h = makeHarness({
      now: at(500),
      initialCache: { sessionToken, entitlementToken },
      fetchRejects: true
    })
    await h.service.init()
    const state = h.service.getState()
    expect(state.signedIn).toBe(true)
    expect(state.plan).toBe('community')
    expect(state.capabilities).toEqual([])
  })

  it('re-polls when online and past refreshAfter, picking up a plan change', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    // cached entitlement is community and stale (issued at IAT, now +25h > refreshAfter)
    const cachedEntitlement = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'community',
      capabilities: []
    })
    // the fresh one the backend now returns is pro
    const freshEntitlement = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT + 60 * 60 * 25,
      plan: 'pro',
      capabilities: ['scenario.stepDebug']
    })
    const h = makeHarness({
      now: at(60 * 60 * 25),
      initialCache: { sessionToken, entitlementToken: cachedEntitlement },
      entitlementToken: freshEntitlement
    })

    await h.service.init()

    expect(h.fetchMock.mock.calls.length).toBeGreaterThan(0)
    const state = h.service.getState()
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toEqual(['scenario.stepDebug'])
  })

  it('keeps the cached (within-grace) entitlement when an online refresh fails', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const cachedEntitlement = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.stepDebug']
    })
    // now past refreshAfter → triggers a refresh, but the network is down.
    const h = makeHarness({
      now: at(60 * 60 * 25),
      initialCache: { sessionToken, entitlementToken: cachedEntitlement },
      fetchRejects: true
    })
    await h.service.init()
    const state = h.service.getState()
    expect(state.plan).toBe('pro') // cached entitlement preserved
    expect(state.capabilities).toEqual(['scenario.stepDebug'])
  })
})

describe('EntitlementService — refresh (auto-refresh trigger target)', () => {
  it('re-fetches and broadcasts a plan change (community → pro) without a re-login', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const community = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, plan: 'community', capabilities: [] })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken: community })
    await h.service.signIn()
    expect(h.service.getState().plan).toBe('community')
    h.broadcasts.length = 0

    // The backend now returns a pro entitlement (the user upgraded via checkout).
    const pro = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.stepDebug']
    })
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ entitlement: pro }), { status: 200 }))

    await h.service.refresh()

    const state = h.service.getState()
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toEqual(['scenario.stepDebug'])
    expect(last(h.broadcasts)).toMatchObject({ plan: 'pro' })
  })

  it('is a no-op when signed out (no fetch, no broadcast)', async () => {
    const h = makeHarness({ now: at(10) })
    await h.service.refresh()
    expect(h.fetchMock.mock.calls.length).toBe(0)
    expect(h.broadcasts.length).toBe(0)
  })

  it('keeps the cached entitlement when a refresh fails (offline) — no sign-out', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const pro = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, plan: 'pro', capabilities: ['scenario.stepDebug'] })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken: pro })
    await h.service.signIn()

    h.fetchMock.mockRejectedValueOnce(new Error('offline'))
    await h.service.refresh()

    const state = h.service.getState()
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toEqual(['scenario.stepDebug'])
  })
})

describe('EntitlementService — startCheckout', () => {
  it('returns null when there is no signed-in session', async () => {
    const h = makeHarness({ now: at(10) })
    expect(await h.service.startCheckout()).toBeNull()
  })

  it('POSTs to the checkout endpoint with the session bearer and returns the URL when signed in', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.stepDebug']
    })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()

    // The next fetch (the checkout POST) returns the hosted Paddle URL.
    h.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ transactionId: 'txn_1', checkoutUrl: 'https://pay.paddle.com/abc' }), { status: 200 })
    )
    const result = await h.service.startCheckout()
    expect(result).toEqual({ checkoutUrl: 'https://pay.paddle.com/abc' })
    const lastCall = last(h.fetchMock.mock.calls) as unknown as [string, RequestInit]
    expect(lastCall[0]).toContain('/checkout')
    expect(lastCall[1].method).toBe('POST')
    expect((lastCall[1].headers as Record<string, string>)['authorization']).toBe(`Bearer ${sessionToken}`)
  })

  it('surfaces a backend HTTP error (e.g. 403 admin-only) by throwing', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()
    h.fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    await expect(h.service.startCheckout()).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('EntitlementService — startCustomerPortal', () => {
  it('returns null when there is no signed-in session', async () => {
    const h = makeHarness({ now: at(10) })
    expect(await h.service.startCustomerPortal()).toBeNull()
  })

  it('POSTs to the portal endpoint with the session bearer and returns the URL when signed in', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.stepDebug']
    })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()

    // The next fetch (the portal POST) returns the hosted Paddle portal URL.
    h.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ portalUrl: 'https://customer-portal.paddle.com/abc' }), { status: 200 })
    )
    const result = await h.service.startCustomerPortal()
    expect(result).toEqual({ portalUrl: 'https://customer-portal.paddle.com/abc' })
    const lastCall = last(h.fetchMock.mock.calls) as unknown as [string, RequestInit]
    expect(lastCall[0]).toContain('/customer-portal')
    expect(lastCall[1].method).toBe('POST')
    expect((lastCall[1].headers as Record<string, string>)['authorization']).toBe(`Bearer ${sessionToken}`)
  })

  it('returns { portalUrl: null } when the account has no billing customer', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()
    h.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ portalUrl: null }), { status: 200 }))
    expect(await h.service.startCustomerPortal()).toEqual({ portalUrl: null })
  })

  it('rethrows a backend HTTP error', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const h = makeHarness({ now: at(10), sessionToken, entitlementToken })
    await h.service.signIn()
    h.fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(h.service.startCustomerPortal()).rejects.toThrow()
  })
})

describe('EntitlementService — seedEntitlementForE2E / __seedEntitlementForTesting seam', () => {
  // These tests cover the dev-only e2e seam used by the mcp-server e2e suite to
  // boot the app as a Pro user without a real signed JWT.

  it('(a) seeds plan=pro + mcp.pro capability when isPackaged=false and envPlan=pro', () => {
    const h = makeHarness()
    const seeded = seedEntitlementForE2E(h.service, false, 'pro')

    expect(seeded).toBe(true)
    const state = h.service.getState()
    expect(state.signedIn).toBe(true)
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toContain('mcp.pro')
    // The seed broadcasts immediately so renderers reflect it at first paint.
    expect(last(h.broadcasts)).toMatchObject({ plan: 'pro', signedIn: true })
  })

  it('(b) is a strict NO-OP when app.isPackaged=true, even with envPlan=pro', () => {
    const h = makeHarness()
    const seeded = seedEntitlementForE2E(h.service, /* isPackaged */ true, 'pro')

    expect(seeded).toBe(false)
    const state = h.service.getState()
    // Community / signed-out: the seam must be unreachable in packaged builds.
    expect(state.plan).toBe('community')
    expect(state.signedIn).toBe(false)
    expect(state.capabilities).toEqual([])
    expect(h.broadcasts.length).toBe(0)
  })

  it('is a NO-OP when envPlan is unset (undefined)', () => {
    const h = makeHarness()
    const seeded = seedEntitlementForE2E(h.service, false, undefined)

    expect(seeded).toBe(false)
    expect(h.service.getState().plan).toBe('community')
  })

  it('is a NO-OP when envPlan is some other value (not "pro")', () => {
    const h = makeHarness()
    const seeded = seedEntitlementForE2E(h.service, false, 'community')

    expect(seeded).toBe(false)
    expect(h.service.getState().plan).toBe('community')
  })

  it('seeded state survives init() when no cached session exists', async () => {
    // Mirrors the mcp-server e2e boot path: initEntitlementService() seeds first,
    // then init() runs (finds no cached session → community path, calls emit()).
    // The seeded state must win the derive() → renderers get Pro at first paint.
    const h = makeHarness() // no initial cache → init() finds no session
    seedEntitlementForE2E(h.service, false, 'pro')
    await h.service.init()

    const state = h.service.getState()
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toContain('mcp.pro')
    // init() must NOT trigger a network refresh (no sessionToken, seededState bypasses
    // the JWT-path condition check).
    expect(h.fetchMock.mock.calls.length).toBe(0)
  })
})

describe('EntitlementService — reloadFromStore (cross-instance live propagation)', () => {
  it('a login persisted by instance A becomes live in instance B on reload', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({
      privateKey: keys.privateKey,
      iatSeconds: IAT,
      plan: 'pro',
      capabilities: ['scenario.headless']
    })
    const shared = { value: null as Persisted | null }
    const a = makeHarness({ now: at(10), sessionToken, entitlementToken, sharedCache: shared })
    const b = makeHarness({ now: at(10), sharedCache: shared })

    await b.service.init()
    expect(last(b.broadcasts).signedIn).toBe(false)

    await a.service.signIn()
    // The watcher fires in B → B re-reads the shared store.
    await b.service.reloadFromStore()

    const state = last(b.broadcasts)
    expect(state.signedIn).toBe(true)
    expect(state.plan).toBe('pro')
    expect(state.capabilities).toEqual(['scenario.headless'])
    // B never talked to the network: the writer fetched, the reader verified.
    expect(b.fetchMock.mock.calls.length).toBe(0)
  })

  it('a logout in instance A signs instance B out on reload', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT })
    const shared = { value: null as Persisted | null }
    const a = makeHarness({ now: at(10), sessionToken, entitlementToken, sharedCache: shared })
    const b = makeHarness({ now: at(10), sharedCache: shared })

    await a.service.signIn()
    await b.service.reloadFromStore()
    expect(last(b.broadcasts).signedIn).toBe(true)

    a.service.signOut()
    await b.service.reloadFromStore()
    expect(last(b.broadcasts).signedIn).toBe(false)
  })

  it('a plan change persisted by A reaches B on reload', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const community = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, plan: 'community', capabilities: [] })
    const pro = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, plan: 'pro', capabilities: ['scenario.headless'] })
    const shared = { value: { sessionToken, entitlementToken: community } }
    const b = makeHarness({ now: at(10), sharedCache: shared })
    await b.service.init()
    expect(last(b.broadcasts).plan).toBe('community')

    // Instance A refreshed and persisted the upgraded entitlement.
    shared.value = { sessionToken, entitlementToken: pro }
    await b.service.reloadFromStore()
    expect(last(b.broadcasts).plan).toBe('pro')
  })

  it('trust-model guard: a doctored cache grants nothing without a valid signature', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    // Signed with a DIFFERENT key than the one the service verifies against.
    const foreign = await generateEdKeyPair()
    const forged = await signEntitlement({
      privateKey: foreign.privateKey,
      iatSeconds: IAT,
      plan: 'enterprise',
      capabilities: ['scenario.headless', 'audit.logs']
    })
    const shared = { value: { sessionToken, entitlementToken: forged } }
    const b = makeHarness({ now: at(10), sharedCache: shared })

    await b.service.reloadFromStore()

    const state = last(b.broadcasts)
    expect(state.signedIn).toBe(true) // the session itself is fine
    expect(state.plan).toBe('community') // but the forged entitlement grants NOTHING
    expect(state.capabilities).toEqual([])
  })

  it('a reload of an identical state does not re-broadcast (self-write dedup)', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const entitlementToken = await signEntitlement({ privateKey: keys.privateKey, iatSeconds: IAT, plan: 'pro' })
    const a = makeHarness({ now: at(10), sessionToken, entitlementToken })

    await a.service.signIn()
    const broadcastsAfterLogin = a.broadcasts.length

    // The fs.watch event caused by our OWN persist() lands here.
    await a.service.reloadFromStore()
    expect(a.broadcasts.length).toBe(broadcastsAfterLogin)
  })

  it('reload is read-only: an expired cached session is adopted as signed-out but never cleared', async () => {
    const sessionToken = await signSession({ secret: SESSION_SECRET, email: 'a@b.com', iatSeconds: IAT })
    const shared = { value: { sessionToken, entitlementToken: null } }
    // 40 days later: the 30-day session is past its life.
    const b = makeHarness({ now: at(40 * 24 * 3600), sharedCache: shared })

    await b.service.reloadFromStore()

    expect(last(b.broadcasts).signedIn).toBe(false)
    // init() would clear; reload must NOT — the writer owns the file.
    expect(b.counters.cleared).toBe(0)
    expect(shared.value).not.toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.mock calls are hoisted by vitest; factory vars must be declared via vi.hoisted.
const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  generateLoopbackNonce: vi.fn(() => 'test-nonce-123'),
  buildLoginUrl: vi.fn(
    (loginUrl: string, returnTo: string, nonce: string) =>
      `${loginUrl}?return_to=${encodeURIComponent(returnTo)}&nonce=${nonce}`
  ),
  LoopbackLoginCancelledError: class LoopbackLoginCancelledError extends Error {
    constructor() {
      super('loopback: login attempt cancelled')
      this.name = 'LoopbackLoginCancelledError'
    }
  }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: mocks.logger,
  generateLoopbackNonce: mocks.generateLoopbackNonce,
  buildLoginUrl: mocks.buildLoginUrl,
  LoopbackLoginCancelledError: mocks.LoopbackLoginCancelledError
}))

import {
  isDeepLinkUrl,
  handleDeepLinkUrl,
  routeDeepLinkUrl,
  initDeepLinkRelay,
  deepLinkLogin,
  resetDeepLinkStateForTests
} from './deepLink'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

beforeEach(() => {
  resetDeepLinkStateForTests()
  vi.clearAllMocks()
  mocks.generateLoopbackNonce.mockReturnValue('test-nonce-123')
  mocks.buildLoginUrl.mockImplementation(
    (loginUrl: string, returnTo: string, nonce: string) =>
      `${loginUrl}?return_to=${encodeURIComponent(returnTo)}&nonce=${nonce}`
  )
})

afterEach(() => {
  resetDeepLinkStateForTests()
})

// ── isDeepLinkUrl ─────────────────────────────────────────────────────────────

describe('isDeepLinkUrl', () => {
  it('recognises restorm:// URLs', () => {
    expect(isDeepLinkUrl('restorm://auth/callback?code=x&state=y')).toBe(true)
  })

  it('recognises restorm-preview:// URLs', () => {
    expect(isDeepLinkUrl('restorm-preview://auth/callback?code=x&state=y')).toBe(true)
  })

  it('rejects http URLs', () => {
    expect(isDeepLinkUrl('http://127.0.0.1:12345/callback')).toBe(false)
  })

  it('rejects https URLs', () => {
    expect(isDeepLinkUrl('https://example.com/')).toBe(false)
  })

  it('rejects near-miss scheme restormx://', () => {
    expect(isDeepLinkUrl('restormx://auth/callback')).toBe(false)
  })
})

// ── handleDeepLinkUrl ─────────────────────────────────────────────────────────

describe('handleDeepLinkUrl', () => {
  it('with no login in-flight and no relay, the callback is dropped with a warning', () => {
    handleDeepLinkUrl('restorm://auth/callback?code=abc&state=xyzxyzxyz')
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('relay is not initialized')
    )
  })

  it('resolves the pending callback with the code when state matches', async () => {
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({ access_token: 'jwt-token-from-server' })
      })
    })

    // The pending callback is now registered; dispatch the deep-link.
    handleDeepLinkUrl('restorm://auth/callback?code=ONE_TIME_CODE&state=test-nonce-123')

    const token = await received
    expect(token).toBe('jwt-token-from-server')
  })

  it('a mismatched state never completes this login and leaves it pending (CSRF + fan-out)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt-token-from-server' })
    })
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl
    })

    // A callback addressed to ANOTHER instance's nonce: it must neither
    // complete nor kill OUR pending login…
    handleDeepLinkUrl('restorm://auth/callback?code=CODE&state=SOMEONE_ELSES_NONCE')
    expect(fetchImpl).not.toHaveBeenCalled()

    // …which still completes normally when OUR callback arrives.
    handleDeepLinkUrl('restorm://auth/callback?code=OURS&state=test-nonce-123')
    await expect(received).resolves.toBe('jwt-token-from-server')
  })

  it('a malformed URL is dropped without killing the pending login', async () => {
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({ access_token: 'jwt' })
      })
    })

    handleDeepLinkUrl('not a url at all :::')
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed URL'))

    handleDeepLinkUrl('restorm://auth/callback?code=OK&state=test-nonce-123')
    await expect(received).resolves.toBe('jwt')
  })

  it('rejects when the code is missing', async () => {
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn()
    })

    handleDeepLinkUrl('restorm://auth/callback?state=test-nonce-123')

    await expect(received).rejects.toThrow('missing or oversized code')
  })
})

// ── deepLinkLogin ─────────────────────────────────────────────────────────────

describe('deepLinkLogin', () => {
  it('opens the browser with the correct login URL and scheme', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt-abc' })
    })

    const login = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm-preview',
      openExternal,
      fetchImpl
    })

    handleDeepLinkUrl('restorm-preview://auth/callback?code=CODE&state=test-nonce-123')

    await login
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringContaining('restorm-preview%3A%2F%2Fauth%2Fcallback')
    )
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('test-nonce-123'))
  })

  it('POSTs the code to the session URL and returns the access_token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt-xyz' })
    })

    const login = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl
    })

    handleDeepLinkUrl('restorm://auth/callback?code=MY_CODE&state=test-nonce-123')

    const token = await login
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'MY_CODE' })
      })
    )
    expect(token).toBe('jwt-xyz')
  })

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      deepLinkLogin({
        loginUrl: 'https://api.example.com/login',
        sessionUrl: 'https://api.example.com/session',
        scheme: 'restorm',
        openExternal: vi.fn(),
        fetchImpl: vi.fn(),
        signal: controller.signal
      })
    ).rejects.toThrow('cancelled')
  })

  it('supersedes a prior in-flight attempt when called again', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt-new' })
    })

    mocks.generateLoopbackNonce
      .mockReturnValueOnce('nonce-first')
      .mockReturnValueOnce('nonce-second')

    const first = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal,
      fetchImpl
    })

    // Second call supersedes the first.
    const second = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal,
      fetchImpl
    })

    // First should be cancelled.
    await expect(first).rejects.toThrow('cancelled')

    // Dispatch the callback for the SECOND nonce.
    handleDeepLinkUrl('restorm://auth/callback?code=CODE2&state=nonce-second')

    expect(await second).toBe('jwt-new')
  })

  it('throws when the session exchange returns a non-ok status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => ({})
    })

    const login = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl
    })

    handleDeepLinkUrl('restorm://auth/callback?code=CODE&state=test-nonce-123')

    await expect(login).rejects.toThrow('session exchange failed with status 401')
  })

  it('throws when the session exchange response is missing access_token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ not_a_token: 'surprise' })
    })

    const login = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl
    })

    handleDeepLinkUrl('restorm://auth/callback?code=CODE&state=test-nonce-123')

    await expect(login).rejects.toThrow('missing access_token')
  })
})

// ── cross-instance relay + URL router ────────────────────────────────────────

describe('deep-link relay (cross-instance nonce-claim)', () => {
  let inboxRoot: string

  beforeEach(() => {
    inboxRoot = mkdtempSync(join(tmpdir(), 'restorm-relay-'))
    initDeepLinkRelay(inboxRoot)
  })

  afterEach(() => {
    rmSync(inboxRoot, { recursive: true, force: true })
  })

  const login = (fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: () => ({ access_token: 'jwt-relayed' })
  })): Promise<string> =>
    deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl
    })

  it('a callback with no matching local login lands in the inbox for others to claim', () => {
    handleDeepLinkUrl('restorm://auth/callback?code=THE_CODE&state=other-instance-nonce')
    const files = readdirSync(join(inboxRoot, 'auth-callbacks'))
    expect(files).toEqual(['cb-other-instance-nonce.json'])
  })

  it('a login started AFTER the relay write claims and completes from the inbox', async () => {
    // Instance P (the primary) received a callback answering OUR login before
    // we even registered it — the eager claim inside deepLinkLogin covers this.
    handleDeepLinkUrl('restorm://auth/callback?code=RELAYED_CODE&state=test-nonce-123')
    const token = await login()
    expect(token).toBe('jwt-relayed')
    // Claim consumed the file.
    expect(readdirSync(join(inboxRoot, 'auth-callbacks'))).toEqual([])
  })

  it('the claim is single-winner: a second claim attempt finds nothing', async () => {
    handleDeepLinkUrl('restorm://auth/callback?code=ONCE&state=test-nonce-123')
    await login()
    // The file is gone; a new login with the same nonce cannot re-claim it and
    // must wait for its own callback (i.e. the promise stays pending).
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt-fresh' })
    })
    let settled = false
    const second = login(fetchImpl).finally(() => { settled = true })
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    // Complete it normally so the test leaves no dangling promise.
    handleDeepLinkUrl('restorm://auth/callback?code=FRESH&state=test-nonce-123')
    await second
  })

  it('a relayed callback addressed to a DIFFERENT nonce is never claimed by this instance', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt' })
    })
    const received = login(fetchImpl)
    // Someone relays a callback for another instance while we wait.
    writeFileSync(
      join(inboxRoot, 'auth-callbacks', 'cb-not-our-nonce.json'),
      JSON.stringify({ code: 'NOT_OURS' }),
      { mode: 0o600 }
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchImpl).not.toHaveBeenCalled() // no mis-dispatch
    handleDeepLinkUrl('restorm://auth/callback?code=OURS&state=test-nonce-123')
    await expect(received).resolves.toBe('jwt')
  })

  it('a hostile state token never becomes a filename', () => {
    handleDeepLinkUrl('restorm://auth/callback?code=X&state=../../escape')
    const files = readdirSync(join(inboxRoot, 'auth-callbacks'))
    expect(files).toEqual([])
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed state or code')
    )
  })
})

describe('routeDeepLinkUrl (auth vs everything else)', () => {
  it('routes restorm://auth/callback to the auth handler', async () => {
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({ access_token: 'jwt-routed' })
      })
    })
    routeDeepLinkUrl('restorm://auth/callback?code=C&state=test-nonce-123')
    await expect(received).resolves.toBe('jwt-routed')
  })

  it('does NOT route restorm://open?... (the future file form) to the auth handler', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ access_token: 'jwt-late' })
    })
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl
    })
    routeDeepLinkUrl('restorm://open?path=%2Ftmp%2Fapi.restorm&code=C&state=test-nonce-123')
    // Even though the URL happens to carry code+state params, the router must
    // keep it away from auth: the login stays pending, nothing was exchanged —
    // and the relay must not have inboxed it either (it never reached auth).
    expect(fetchImpl).not.toHaveBeenCalled()
    routeDeepLinkUrl('restorm://auth/callback?code=C&state=test-nonce-123')
    await received
  })
})

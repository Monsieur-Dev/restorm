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
  deepLinkLogin,
  resetDeepLinkStateForTests
} from './deepLink'

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
  it('logs a warning and does nothing when no login is in-flight', () => {
    handleDeepLinkUrl('restorm://auth/callback?code=abc&state=xyz')
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no login is in-flight'),
      expect.any(Object)
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

  it('rejects when the state does not match the nonce (CSRF guard)', async () => {
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn()
    })

    handleDeepLinkUrl('restorm://auth/callback?code=CODE&state=WRONG_NONCE')

    await expect(received).rejects.toThrow('state mismatch')
  })

  it('rejects when the URL is malformed', async () => {
    const received = deepLinkLogin({
      loginUrl: 'https://api.example.com/login',
      sessionUrl: 'https://api.example.com/session',
      scheme: 'restorm',
      openExternal: vi.fn().mockResolvedValue(undefined),
      fetchImpl: vi.fn()
    })

    handleDeepLinkUrl('not a url at all :::')

    await expect(received).rejects.toThrow('malformed URL')
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

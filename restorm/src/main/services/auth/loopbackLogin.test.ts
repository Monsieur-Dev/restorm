// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildLoginUrl,
  evaluateCallback,
  exchangeCodeForSession,
  loopbackLogin
} from './loopbackLogin'

describe('buildLoginUrl', () => {
  it('encodes the loopback return target + nonce as query params', () => {
    const url = new URL(buildLoginUrl('https://x.supabase.co/functions/v1/login', 'http://127.0.0.1:5050/callback', 'nonce-abc'))
    expect(url.searchParams.get('return_to')).toBe('http://127.0.0.1:5050/callback')
    expect(url.searchParams.get('nonce')).toBe('nonce-abc')
  })
})

describe('evaluateCallback (callback-binding guard)', () => {
  it('accepts a GET /callback whose state equals the nonce, returning the code', () => {
    const v = evaluateCallback('GET', '/callback?code=onetime123&state=NONCE', 'NONCE')
    expect(v.status).toBe(200)
    expect(v.code).toBe('onetime123')
  })

  it('refuses a mismatched state (CSRF / wrong nonce) without yielding a code', () => {
    const v = evaluateCallback('GET', '/callback?code=onetime123&state=WRONG', 'NONCE')
    expect(v.status).toBe(400)
    expect(v.code).toBeUndefined()
  })

  it('refuses non-GET, the wrong path, and a missing code', () => {
    expect(evaluateCallback('POST', '/callback?code=c&state=NONCE', 'NONCE').code).toBeUndefined()
    expect(evaluateCallback('GET', '/favicon.ico', 'NONCE').status).toBe(404)
    expect(evaluateCallback('GET', '/callback?state=NONCE', 'NONCE').code).toBeUndefined()
  })

  it('never echoes the code in the HTML body', () => {
    const v = evaluateCallback('GET', '/callback?code=SECRETCODE&state=NONCE', 'NONCE')
    expect(v.body).not.toContain('SECRETCODE')
  })
})

describe('exchangeCodeForSession', () => {
  it('POSTs the code and returns the access_token', async () => {
    let body: unknown
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      body = JSON.parse(init?.body as string)
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'sess.jwt', token_type: 'Bearer' }), { status: 200 }))
    }) as unknown as typeof fetch
    const token = await exchangeCodeForSession('https://x.supabase.co/functions/v1/session', 'onetime', fetchImpl)
    expect(body).toEqual({ code: 'onetime' })
    expect(token).toBe('sess.jwt')
  })

  it('throws when the response has no access_token', async () => {
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as unknown as typeof fetch
    await expect(exchangeCodeForSession('https://x/session', 'c', fetchImpl)).rejects.toThrow()
  })
})

describe('loopbackLogin end-to-end (real 127.0.0.1 listener)', () => {
  it('opens the browser, receives the callback on the loopback port, and redeems the code', async () => {
    // The fake "browser": parse the login URL, then hit the loopback callback as
    // the backend would (echoing the nonce as `state`).
    const openExternal = async (loginUrl: string): Promise<void> => {
      const url = new URL(loginUrl)
      const returnTo = new URL(url.searchParams.get('return_to') ?? '')
      const nonce = url.searchParams.get('nonce') ?? ''
      returnTo.searchParams.set('code', 'ONE-TIME-CODE')
      returnTo.searchParams.set('state', nonce)
      const res = await fetch(returnTo.toString())
      await res.text()
    }

    // The fake session endpoint.
    const fetchImpl = ((urlArg: string | URL, init?: RequestInit) => {
      const url = typeof urlArg === 'string' ? urlArg : urlArg.toString()
      if (url.includes('/session')) {
        const parsed = JSON.parse(init?.body as string) as { code: string }
        expect(parsed.code).toBe('ONE-TIME-CODE')
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'final.session.jwt' }), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    }) as unknown as typeof fetch

    const token = await loopbackLogin({
      loginUrl: 'https://x.supabase.co/functions/v1/login',
      sessionUrl: 'https://x.supabase.co/functions/v1/session',
      openExternal,
      fetchImpl,
      timeoutMs: 5000
    })

    expect(token).toBe('final.session.jwt')
  })

  it('rejects when opening the browser fails', async () => {
    await expect(loopbackLogin({
      loginUrl: 'https://x.supabase.co/functions/v1/login',
      sessionUrl: 'https://x.supabase.co/functions/v1/session',
      openExternal: () => Promise.reject(new Error('no browser')),
      fetchImpl: (() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch,
      timeoutMs: 5000
    })).rejects.toThrow('no browser')
  })

  it('times out when no callback arrives', async () => {
    await expect(loopbackLogin({
      loginUrl: 'https://x.supabase.co/functions/v1/login',
      sessionUrl: 'https://x.supabase.co/functions/v1/session',
      openExternal: () => Promise.resolve(/* never hits the callback */),
      fetchImpl: (() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch,
      timeoutMs: 50
    })).rejects.toThrow(/timed out/)
  })
})

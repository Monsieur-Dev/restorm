/**
 * CookieJarService — the real (tough-cookie) cookie engine: per-environment
 * isolation, expiry, Path/Domain scoping, and the Cookie Manager mutations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { cookieJarService } from '../../../src/main/services/CookieJarService'

const URL_A = 'https://api.example.com/'
const ENV_A = 'env-a'
const ENV_B = 'env-b'

function cookieHeader(envKey: string, url: string): string | undefined {
  const headers: Record<string, string> = {}
  cookieJarService.applyCookies(envKey, url, headers)
  return headers['Cookie']
}

describe('CookieJarService', () => {
  beforeEach(() => {
    cookieJarService.clear()
  })

  it('captures a Set-Cookie and re-sends it to the same origin', () => {
    cookieJarService.storeCookies(ENV_A, URL_A, 'session=abc; Path=/')
    expect(cookieHeader(ENV_A, URL_A)).toBe('session=abc')
  })

  it('isolates cookies per environment (same origin, different env → not sent)', () => {
    cookieJarService.storeCookies(ENV_A, URL_A, 'session=abc')
    expect(cookieHeader(ENV_A, URL_A)).toBe('session=abc')
    // Env B points at the same origin but has its own jar.
    expect(cookieHeader(ENV_B, URL_A)).toBeUndefined()
  })

  it('does not re-send an expired cookie (Max-Age=0)', () => {
    cookieJarService.storeCookies(ENV_A, URL_A, 'gone=1; Max-Age=0')
    expect(cookieHeader(ENV_A, URL_A)).toBeUndefined()
  })

  it('honours Path scoping', () => {
    cookieJarService.storeCookies(ENV_A, 'https://api.example.com/admin', 'a=1; Path=/admin')
    expect(cookieHeader(ENV_A, 'https://api.example.com/admin/x')).toBe('a=1')
    expect(cookieHeader(ENV_A, 'https://api.example.com/public')).toBeUndefined()
  })

  it('honours Domain scoping (reaches sub-domains)', () => {
    cookieJarService.storeCookies(ENV_A, 'https://example.com/', 'd=1; Domain=example.com')
    expect(cookieHeader(ENV_A, 'https://sub.example.com/')).toBe('d=1')
  })

  it('does not send a Secure cookie over http', () => {
    cookieJarService.storeCookies(ENV_A, 'https://api.example.com/', 's=1; Secure')
    expect(cookieHeader(ENV_A, 'https://api.example.com/')).toBe('s=1')
    expect(cookieHeader(ENV_A, 'http://api.example.com/')).toBeUndefined()
  })

  it('leaves a user-supplied Cookie header untouched', () => {
    cookieJarService.storeCookies(ENV_A, URL_A, 'jar=1')
    const headers: Record<string, string> = { Cookie: 'manual=yes' }
    cookieJarService.applyCookies(ENV_A, URL_A, headers)
    expect(headers['Cookie']).toBe('manual=yes')
  })

  it('lists, adds and removes cookies for the manager', () => {
    cookieJarService.storeCookies(ENV_A, URL_A, 'a=1')
    cookieJarService.addCookie(ENV_A, { key: 'b', value: '2', domain: 'api.example.com', path: '/' })
    const rows = cookieJarService.list(ENV_A)
    expect(rows.map((r) => r.key).sort()).toEqual(['a', 'b'])
    cookieJarService.removeCookie(ENV_A, 'api.example.com', '/', 'a')
    expect(cookieJarService.list(ENV_A).map((r) => r.key)).toEqual(['b'])
    cookieJarService.clearDomain(ENV_A, 'api.example.com')
    expect(cookieJarService.list(ENV_A)).toEqual([])
  })

  it('clears one environment without touching another', () => {
    cookieJarService.storeCookies(ENV_A, URL_A, 'a=1')
    cookieJarService.storeCookies(ENV_B, URL_A, 'b=2')
    cookieJarService.clear(ENV_A)
    expect(cookieHeader(ENV_A, URL_A)).toBeUndefined()
    expect(cookieHeader(ENV_B, URL_A)).toBe('b=2')
  })
})

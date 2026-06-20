import { describe, it, expect } from 'vitest'
import { assertSafeFetchUrl, isSafeFetchUrl } from './urlSecurity'

describe('assertSafeFetchUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(() => assertSafeFetchUrl('https://api.example.com/spec.json')).not.toThrow()
    expect(() => assertSafeFetchUrl('http://example.org:8080/v1')).not.toThrow()
    expect(assertSafeFetchUrl('https://1.2.3.4/x').hostname).toBe('1.2.3.4')
  })

  it('rejects non-http(s) schemes', () => {
    expect(() => assertSafeFetchUrl('file:///etc/passwd')).toThrow(/scheme/)
    expect(() => assertSafeFetchUrl('javascript:alert(1)')).toThrow(/scheme/)
    expect(() => assertSafeFetchUrl('ftp://example.com/x')).toThrow(/scheme/)
  })

  it('rejects malformed URLs', () => {
    expect(() => assertSafeFetchUrl('not a url')).toThrow(/Invalid URL/)
  })

  it('rejects loopback hostnames', () => {
    expect(() => assertSafeFetchUrl('http://localhost/x')).toThrow(/loopback/)
    expect(() => assertSafeFetchUrl('http://foo.localhost/x')).toThrow(/loopback/)
  })

  it('rejects a trailing-dot FQDN that resolves to loopback/private', () => {
    // `new URL` keeps the trailing dot on a NAME, so these would bypass
    // the named-loopback / private-IP checks without normalisation.
    expect(() => assertSafeFetchUrl('http://localhost./x')).toThrow(/loopback/)
    expect(isSafeFetchUrl('http://127.0.0.1./x')).toBe(false)
  })

  it('rejects the cloud metadata endpoint', () => {
    expect(() => assertSafeFetchUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/link-local|metadata/)
  })

  it('rejects RFC1918 and loopback IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.9', '0.0.0.0', '100.64.0.1']) {
      expect(isSafeFetchUrl(`http://${ip}/x`)).toBe(false)
    }
  })

  it('accepts non-private IPv4 in the 172.x range outside /12', () => {
    expect(isSafeFetchUrl('http://172.32.0.1/x')).toBe(true)
    expect(isSafeFetchUrl('http://172.15.0.1/x')).toBe(true)
  })

  it('rejects private/loopback IPv6 (incl. v4-mapped)', () => {
    expect(isSafeFetchUrl('http://[::1]/x')).toBe(false)
    expect(isSafeFetchUrl('http://[fe80::1]/x')).toBe(false)
    expect(isSafeFetchUrl('http://[fd00::1]/x')).toBe(false)
    expect(isSafeFetchUrl('http://[::ffff:10.0.0.1]/x')).toBe(false)
  })

  it('accepts public IPv6', () => {
    expect(isSafeFetchUrl('http://[2606:4700:4700::1111]/x')).toBe(true)
  })
})

describe('assertSafeFetchUrl — allowPrivateHosts (explicit top-level import)', () => {
  const allow = { allowPrivateHosts: true }

  it('allows loopback + RFC1918 private hosts for an explicit import URL', () => {
    // The user/agent typed this URL (e.g. a local dev server) — legitimate.
    expect(() => assertSafeFetchUrl('http://localhost:8080/spec.json', allow)).not.toThrow()
    expect(() => assertSafeFetchUrl('http://127.0.0.1:3000/openapi.json', allow)).not.toThrow()
    expect(() => assertSafeFetchUrl('http://192.168.1.10/spec', allow)).not.toThrow()
    expect(() => assertSafeFetchUrl('http://10.0.0.5/spec', allow)).not.toThrow()
    expect(() => assertSafeFetchUrl('http://[::1]:8080/spec', allow)).not.toThrow()
    expect(() => assertSafeFetchUrl('http://[fd00::1]/spec', allow)).not.toThrow()
  })

  it('STILL blocks link-local / cloud-metadata even with allowPrivateHosts', () => {
    // Importing from the metadata endpoint is never legitimate.
    expect(() => assertSafeFetchUrl('http://169.254.169.254/latest/meta-data/', allow)).toThrow(/link-local|metadata/)
    expect(() => assertSafeFetchUrl('http://[fe80::1]/x', allow)).toThrow(/link-local|metadata/)
    expect(() => assertSafeFetchUrl('http://[::ffff:169.254.169.254]/x', allow)).toThrow(/link-local|metadata/)
  })

  it('still enforces http(s) scheme with allowPrivateHosts', () => {
    expect(() => assertSafeFetchUrl('file:///etc/passwd', allow)).toThrow(/scheme/)
  })

  it('default (no opts) stays strict — a redirect/sub-fetch path blocks private', () => {
    // Models the redirect hop / spec-embedded sub-fetch: NO allowPrivateHosts.
    expect(isSafeFetchUrl('http://127.0.0.1:3000/x')).toBe(false)
    expect(isSafeFetchUrl('http://192.168.1.10/x')).toBe(false)
    expect(isSafeFetchUrl('http://localhost/x')).toBe(false)
  })
})

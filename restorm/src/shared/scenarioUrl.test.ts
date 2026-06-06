import { describe, it, expect } from 'vitest'
import { applyUrl, isUrlOp, URL_OPS } from './scenarioUrl'

describe('scenarioUrl — the one URL core (runtime + preview)', () => {
  it('encode / decode round-trip a component', () => {
    expect(applyUrl('a b&c=d', 'encode')).toBe('a%20b%26c%3Dd')
    expect(applyUrl('a%20b%26c%3Dd', 'decode')).toBe('a b&c=d')
  })

  it('decode of a malformed escape THROWS', () => {
    expect(() => applyUrl('%', 'decode')).toThrow()
  })

  it('parseQuery → object (leading ? optional)', () => {
    expect(applyUrl('?a=1&b=two&a=last', 'parseQuery')).toEqual({ a: 'last', b: 'two' })
    expect(applyUrl('x=hello%20world', 'parseQuery')).toEqual({ x: 'hello world' })
  })

  it('buildQuery → string; non-object THROWS', () => {
    expect(applyUrl({ a: 1, b: 'two' }, 'buildQuery')).toBe('a=1&b=two')
    expect(() => applyUrl('nope', 'buildQuery')).toThrow(/object/)
  })

  it('parseUrl → parts + query; bad URL THROWS', () => {
    expect(applyUrl('https://api.example.com:8443/v1/pets?limit=5#top', 'parseUrl')).toEqual({
      protocol: 'https:',
      hostname: 'api.example.com',
      port: '8443',
      pathname: '/v1/pets',
      search: '?limit=5',
      hash: '#top',
      origin: 'https://api.example.com:8443',
      query: { limit: '5' }
    })
    expect(() => applyUrl('not a url', 'parseUrl')).toThrow()
  })

  it('isUrlOp guards the union', () => {
    expect(URL_OPS).toContain('parseUrl')
    expect(isUrlOp('encode')).toBe(true)
    expect(isUrlOp('slugify')).toBe(false)
  })
})

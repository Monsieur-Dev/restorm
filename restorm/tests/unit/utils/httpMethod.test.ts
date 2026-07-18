import { describe, it, expect } from 'vitest'
import { httpBadgeIdFor, isKnownHttpMethod } from '../../../src/shared/utils/httpMethod'

describe('httpBadgeIdFor', () => {
  it('maps well-known verbs to their registry entry regardless of casing', () => {
    expect(httpBadgeIdFor('GET')).toBe('http_get')
    expect(httpBadgeIdFor('PoSt')).toBe('http_post')
    expect(httpBadgeIdFor('query')).toBe('http_query')
    expect(httpBadgeIdFor('OPTIONS')).toBe('http_options')
  })

  it('falls back to http_other for custom/unknown verbs', () => {
    expect(httpBadgeIdFor('Machin')).toBe('http_other')
    expect(httpBadgeIdFor('X-Custom')).toBe('http_other')
    expect(httpBadgeIdFor('')).toBe('http_other')
  })
})

describe('isKnownHttpMethod', () => {
  it('recognises the well-known verbs case-insensitively, QUERY included', () => {
    expect(isKnownHttpMethod('GET')).toBe(true)
    expect(isKnownHttpMethod('query')).toBe(true)
    expect(isKnownHttpMethod('QUERY')).toBe(true)
  })

  it('rejects custom verbs', () => {
    expect(isKnownHttpMethod('Machin')).toBe(false)
    expect(isKnownHttpMethod('')).toBe(false)
  })
})

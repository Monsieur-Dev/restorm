import { describe, it, expect } from 'vitest'
import { canonicalizeHttpMethod, isKnownHttpMethod } from '../../../src/shared/utils/httpMethod'

describe('canonicalizeHttpMethod', () => {
  it('upper-cases known verbs regardless of the typed casing', () => {
    expect(canonicalizeHttpMethod('get')).toBe('GET')
    expect(canonicalizeHttpMethod('PoSt')).toBe('POST')
    expect(canonicalizeHttpMethod('query')).toBe('QUERY')
    expect(canonicalizeHttpMethod('OPTIONS')).toBe('OPTIONS')
  })

  it('passes a custom/unknown verb through verbatim (method tokens are case-sensitive)', () => {
    expect(canonicalizeHttpMethod('Machin')).toBe('Machin')
    expect(canonicalizeHttpMethod('purge')).toBe('purge')
    expect(canonicalizeHttpMethod('X-Custom')).toBe('X-Custom')
  })

  it('trims surrounding whitespace', () => {
    expect(canonicalizeHttpMethod('  get  ')).toBe('GET')
    expect(canonicalizeHttpMethod('  Machin ')).toBe('Machin')
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

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { expiryTtlMs } from './AuthenticationCacheService'

describe('expiryTtlMs', () => {
  it('returns undefined (never-expires) when no expiry expression is configured', () => {
    expect(expiryTtlMs(undefined, false)).toBeUndefined()
    expect(expiryTtlMs('3600', false)).toBeUndefined()
  })

  it('returns ms for a positive seconds value', () => {
    expect(expiryTtlMs('3600', true)).toBe(3_600_000)
    expect(expiryTtlMs('1.5', true)).toBe(1500)
  })

  // The regression: a configured-but-unusable expression used to return
  // undefined → "never expires" → token cached forever. It must be treated
  // as immediately stale (0) so the next use refetches.
  it('returns 0 (immediately stale) for a configured but invalid/<=0 value', () => {
    expect(expiryTtlMs('', true)).toBe(0)
    expect(expiryTtlMs('not-a-number', true)).toBe(0)
    expect(expiryTtlMs('0', true)).toBe(0)
    expect(expiryTtlMs('-5', true)).toBe(0)
    expect(expiryTtlMs(undefined, true)).toBe(0)
  })
})

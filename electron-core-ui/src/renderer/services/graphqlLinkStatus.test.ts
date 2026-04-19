import { describe, it, expect } from 'vitest'
import {
  computeBackoffDelay,
  INITIAL_RETRY_DELAY_MS,
  JITTER_FACTOR,
  MAX_RETRY_DELAY_MS
} from './graphqlLinkStatus'

describe('computeBackoffDelay', () => {
  /** Deterministic RNG always returning the same jitter multiplier. */
  const constantRandom = (value: number) => (): number => value

  it('starts at INITIAL_RETRY_DELAY_MS with no jitter when random()=0.5', () => {
    // 0.5 is the jitter zero-point: (0.5 * 2 - 1) * baseDelay * JITTER_FACTOR === 0
    expect(computeBackoffDelay(0, constantRandom(0.5))).toBe(INITIAL_RETRY_DELAY_MS)
  })

  it('doubles each attempt until the cap', () => {
    const noJitter = constantRandom(0.5)
    expect(computeBackoffDelay(0, noJitter)).toBe(500)
    expect(computeBackoffDelay(1, noJitter)).toBe(1000)
    expect(computeBackoffDelay(2, noJitter)).toBe(2000)
    expect(computeBackoffDelay(3, noJitter)).toBe(4000)
    expect(computeBackoffDelay(4, noJitter)).toBe(8000)
  })

  it('caps at MAX_RETRY_DELAY_MS once the exponential exceeds it', () => {
    const noJitter = constantRandom(0.5)
    // 500 * 2^5 = 16000 → clamped
    expect(computeBackoffDelay(5, noJitter)).toBe(MAX_RETRY_DELAY_MS)
    expect(computeBackoffDelay(6, noJitter)).toBe(MAX_RETRY_DELAY_MS)
    expect(computeBackoffDelay(20, noJitter)).toBe(MAX_RETRY_DELAY_MS)
  })

  it('applies ±JITTER_FACTOR on either side of the base delay', () => {
    // random()=0  → (-1) * baseDelay * JITTER_FACTOR = -20%
    expect(computeBackoffDelay(0, constantRandom(0))).toBe(Math.round(500 * (1 - JITTER_FACTOR)))
    // random()=1  → (+1) * baseDelay * JITTER_FACTOR = +20%
    expect(computeBackoffDelay(0, constantRandom(1))).toBe(Math.round(500 * (1 + JITTER_FACTOR)))
  })

  it('never returns a negative delay', () => {
    // At the max delay, jitter swings into negative territory:
    // 15000 * 0.2 = 3000, which is still less than 15000 → never negative
    // but the Math.max(0, …) guards defensively against an implementation
    // change to a larger JITTER_FACTOR.
    expect(computeBackoffDelay(20, constantRandom(0))).toBeGreaterThanOrEqual(0)
  })
})

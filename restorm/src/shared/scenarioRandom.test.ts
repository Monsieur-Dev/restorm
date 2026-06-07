import { describe, it, expect } from 'vitest'
import { applyRandom, isRandomOp, RANDOM_OPS } from './scenarioRandom'

describe('scenarioRandom — the one random core (runtime + preview)', () => {
  it('a seed makes every op deterministic + reproducible', () => {
    expect(applyRandom('int', { min: 1, max: 6, seed: 42 })).toBe(applyRandom('int', { min: 1, max: 6, seed: 42 }))
    expect(applyRandom('string', { length: 8, seed: 'abc' })).toBe(applyRandom('string', { length: 8, seed: 'abc' }))
    expect(applyRandom('boolean', { seed: 7 })).toBe(applyRandom('boolean', { seed: 7 }))
  })

  it('int stays within [min, max] (inclusive)', () => {
    for (let s = 0; s < 50; s++) {
      const n = applyRandom('int', { min: 10, max: 12, seed: s }) as number
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(10)
      expect(n).toBeLessThanOrEqual(12)
    }
  })

  it('float stays within [min, max)', () => {
    const f = applyRandom('float', { min: 0, max: 1, seed: 3 }) as number
    expect(f).toBeGreaterThanOrEqual(0)
    expect(f).toBeLessThan(1)
  })

  it('string has the requested length + is alphanumeric', () => {
    const s = applyRandom('string', { length: 20, seed: 99 }) as string
    expect(s).toHaveLength(20)
    expect(s).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('pick returns an element; empty list THROWS', () => {
    expect(['a', 'b', 'c']).toContain(applyRandom('pick', { items: ['a', 'b', 'c'], seed: 5 }))
    expect(() => applyRandom('pick', { items: [], seed: 1 })).toThrow(/non-empty/)
  })

  it('isRandomOp guards the union', () => {
    expect(RANDOM_OPS).toContain('int')
    expect(isRandomOp('pick')).toBe(true)
    expect(isRandomOp('gaussian')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { applyMath, isMathOp } from './scenarioMath'

describe('applyMath', () => {
  it('rounds with precision', () => {
    expect(applyMath(3.14159, 'round')).toBe(3)
    expect(applyMath(3.14159, 'round', { precision: 2 })).toBe(3.14)
    expect(applyMath(2.5, 'round')).toBe(3)
  })

  it('floor / ceil / trunc', () => {
    expect(applyMath(2.9, 'floor')).toBe(2)
    expect(applyMath(2.1, 'ceil')).toBe(3)
    expect(applyMath(-2.7, 'trunc')).toBe(-2)
  })

  it('abs / sign', () => {
    expect(applyMath(-5, 'abs')).toBe(5)
    expect(applyMath(-5, 'sign')).toBe(-1)
    expect(applyMath(0, 'sign')).toBe(0)
  })

  it('sqrt (throws on negative)', () => {
    expect(applyMath(9, 'sqrt')).toBe(3)
    expect(() => applyMath(-1, 'sqrt')).toThrow()
  })

  it('min / max read b', () => {
    expect(applyMath(3, 'min', { b: 5 })).toBe(3)
    expect(applyMath(3, 'max', { b: 5 })).toBe(5)
  })

  it('clamp pins into [min, max]', () => {
    expect(applyMath(7, 'clamp', { min: 0, max: 5 })).toBe(5)
    expect(applyMath(-2, 'clamp', { min: 0, max: 5 })).toBe(0)
    expect(applyMath(3, 'clamp', { min: 0, max: 5 })).toBe(3)
    expect(() => applyMath(3, 'clamp', { min: 5, max: 0 })).toThrow()
  })

  it('coerces numeric strings, throws on non-numbers', () => {
    expect(applyMath('4', 'sqrt')).toBe(2)
    expect(() => applyMath('abc', 'abs')).toThrow()
    expect(() => applyMath(null, 'abs')).toThrow()
    expect(() => applyMath(3, 'min', { b: 'x' })).toThrow()
  })

  it('isMathOp guards', () => {
    expect(isMathOp('round')).toBe(true)
    expect(isMathOp('nope')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { compareValues, deepEqual, isNumericString } from './scenarioComparison'

describe('scenarioComparison — the one comparison core (runtime + preview)', () => {
  it('lists compare by SET (order-independent) for = / ≠', () => {
    expect(compareValues('=', ['a', 'b'], ['b', 'a'])).toBe(true)
    expect(compareValues('≠', ['a', 'b'], ['b', 'a'])).toBe(false)
    expect(compareValues('=', ['a', 'b'], ['a', 'a'])).toBe(false)
  })

  it('contains is SUBSET for list∋list and MEMBERSHIP for list∋element', () => {
    expect(compareValues('contains', ['Vert', 'Rouge'], ['Vert'])).toBe(true) // subset
    expect(compareValues('contains', ['Vert', 'Rouge'], ['Bleu'])).toBe(false)
    expect(compareValues('contains', ['Vert', 'Rouge'], 'Vert')).toBe(true) // membership
  })

  it('objects compare deep (= ) and by SUBSET (contains)', () => {
    expect(compareValues('=', { a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(compareValues('contains', { a: 1, b: 2 }, { a: 1 })).toBe(true)
    expect(deepEqual({ x: [1, { y: 2 }] }, { x: [1, { y: 2 }] })).toBe(true)
  })

  it('null equals only null, and ordering a null throws', () => {
    expect(compareValues('=', null, null)).toBe(true)
    expect(compareValues('=', null, '')).toBe(false)
    expect(compareValues('=', null, 0)).toBe(false)
    expect(compareValues('≤', null, null)).toBe(true) // reflexive
    expect(() => compareValues('<', null, 5)).toThrow(/cannot order null/)
  })

  it('does NOT coerce a numeric string for equality (matches the strict runtime)', () => {
    expect(compareValues('=', 5, '5')).toBe(false)
    // but ordering coerces a numeric string against a number
    expect(compareValues('<', '5', 10)).toBe(true)
    expect(isNumericString('5')).toBe(true)
    expect(isNumericString('abc')).toBe(false)
  })

  it('dates compare at SECOND precision (sub-second ms ignored) with a date hint', () => {
    const a = '2026-06-04T17:15:02.794Z'
    const b = '2026-06-04T17:15:02.000Z'
    expect(compareValues('=', a, b, 'date', 'date')).toBe(true)
    // ordering a list / object throws
    expect(() => compareValues('<', [1, 2], [3])).toThrow(/cannot order/)
  })
})

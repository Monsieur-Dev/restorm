import { describe, it, expect } from 'vitest'
import { compareValues } from './conditionEval'

/**
 * Type-aware comparison: ordering (`< ≤ ≥ >`) is only meaningful for some
 * types and THROWS otherwise (objects, lists, booleans, colours, mixed types);
 * equality compares by structure (objects deep, lists as unordered sets);
 * `∋` is subset / substring / membership. Operand kinds are inferred from the
 * value, refined by a declared-type hint for string-backed subtypes
 * (date / colour / enum) that all resolve to strings at runtime.
 */
describe('compareValues — ordering (< ≤ ≥ >)', () => {
  it('compares numbers numerically', () => {
    expect(compareValues('<', 1, 2)).toBe(true)
    expect(compareValues('<', 2, 1)).toBe(false)
    expect(compareValues('≥', 2, 2)).toBe(true)
  })

  it('compares plain strings lexicographically (NOT numerically)', () => {
    expect(compareValues('<', 'apple', 'banana')).toBe(true)
    expect(compareValues('<', '10', '2')).toBe(true) // lexicographic: "1" < "2"
  })

  it('compares dates chronologically when both are declared datetime', () => {
    expect(compareValues('<', '2020-01-01', '2021-01-01', 'date', 'date')).toBe(true)
    expect(compareValues('>', '2021-06-01T00:00:00Z', '2020-01-01', 'date', 'date')).toBe(true)
  })

  it('compares an all-numeric enum numerically, a label enum lexicographically', () => {
    expect(compareValues('<', '2', '10', 'enum', 'enum')).toBe(true) // numeric: 2 < 10
    expect(compareValues('<', 'Rouge', 'Vert', 'enum', 'enum')).toBe(true) // lexico
  })

  it('honours an explicit enumNumeric flag (whole-option-set decision)', () => {
    // The option set is NOT all-numeric → lexicographic even for numeric values:
    expect(compareValues('<', '2', '10', { kind: 'enum', enumNumeric: false }, { kind: 'enum', enumNumeric: false })).toBe(false) // "2" > "1..."
    // The option set IS all-numeric → numeric:
    expect(compareValues('<', '2', '10', { kind: 'enum', enumNumeric: true }, { kind: 'enum', enumNumeric: true })).toBe(true)
  })

  it('THROWS for objects, lists, booleans and colours', () => {
    expect(() => compareValues('<', { a: 1 }, { a: 2 })).toThrow()
    expect(() => compareValues('>', [1, 2], [3, 4])).toThrow()
    expect(() => compareValues('<', true, false)).toThrow()
    expect(() => compareValues('<', '#000000', '#ffffff', 'color', 'color')).toThrow()
  })

  it('THROWS for mixed types (number vs NON-numeric string)', () => {
    expect(() => compareValues('<', 1, 'a')).toThrow()
    expect(() => compareValues('<', 'a', 1)).toThrow()
  })

  it('coerces a NUMERIC string against a number and compares numerically', () => {
    // A numeric literal is routinely stored as a string operand (e.g. a loop
    // bound) — `counter < "3"` must stay a number comparison, not throw.
    expect(compareValues('<', 0, '3')).toBe(true)
    expect(compareValues('<', 5, '3')).toBe(false)
    expect(compareValues('≥', 0, '0')).toBe(true)
    expect(compareValues('>', '10', 2)).toBe(true) // "10" coerces to 10 > 2
    // Two bare strings are still lexicographic, NOT coerced:
    expect(compareValues('<', '10', '2')).toBe(true)
  })
})

describe('compareValues — equality (= ≠)', () => {
  it('compares objects by deep structure', () => {
    expect(compareValues('=', { a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(compareValues('=', { a: 1 }, { a: 2 })).toBe(false)
    expect(compareValues('≠', { a: 1 }, { a: 2 })).toBe(true)
  })

  it('compares lists as UNORDERED multisets', () => {
    expect(compareValues('=', [1, 2, 3], [3, 1, 2])).toBe(true)
    expect(compareValues('=', [1, 2], [1, 2, 3])).toBe(false)
    expect(compareValues('=', [1, 1, 2], [1, 2, 2])).toBe(false) // multiset, counts matter
    expect(compareValues('=', [{ a: 1 }], [{ a: 1 }])).toBe(true)
  })

  it('treats different types as not-equal (no throw)', () => {
    expect(compareValues('=', '2', 2)).toBe(false)
    expect(compareValues('≠', '2', 2)).toBe(true)
    expect(compareValues('=', { a: 1 }, [1])).toBe(false)
  })

  it('compares dates by instant when declared', () => {
    expect(compareValues('=', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00.000Z', 'date', 'date')).toBe(true)
  })
})

describe('compareValues — contains (∋)', () => {
  it('object ∋ object is subset (right ⊆ left, common props equal)', () => {
    expect(compareValues('∋', { a: 1, b: 2 }, { a: 1 })).toBe(true)
    expect(compareValues('∋', { a: 1, b: 2 }, { a: 2 })).toBe(false)
    expect(compareValues('∋', { a: 1 }, { c: 1 })).toBe(false)
  })

  it('string ∋ string is substring', () => {
    expect(compareValues('∋', 'hello world', 'o w')).toBe(true)
    expect(compareValues('∋', 'hello', 'xyz')).toBe(false)
  })

  it('list ∋ x is membership by deep equality', () => {
    expect(compareValues('∋', [1, 2, 3], 2)).toBe(true)
    expect(compareValues('∋', [1, 2, 3], 5)).toBe(false)
    expect(compareValues('∋', [{ a: 1 }], { a: 1 })).toBe(true)
  })

  it('multi-enum (comma-joined string) ∋ enum is substring', () => {
    expect(compareValues('∋', 'Rouge,Vert', 'Vert', 'enum', 'enum')).toBe(true)
  })

  it('THROWS for unsupported left kinds (e.g. boolean)', () => {
    expect(() => compareValues('∋', true, false)).toThrow()
  })
})

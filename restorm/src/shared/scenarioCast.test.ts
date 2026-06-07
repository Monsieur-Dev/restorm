import { describe, it, expect } from 'vitest'
import { castValue, isScenarioCastType, SCENARIO_CAST_TYPES } from './scenarioCast'

describe('scenarioCast — the one cast core (runtime + preview)', () => {
  it('wraps ANYTHING into a single-element list (no split, lists nest)', () => {
    expect(castValue(5, 'list')).toEqual([5])
    expect(castValue('a,b', 'list')).toEqual(['a,b'])
    expect(castValue([1, 2], 'list')).toEqual([[1, 2]])
    expect(castValue({ a: 1 }, 'list')).toEqual([{ a: 1 }])
  })

  it('→ string: scalars display, date → ISO, list/object throw', () => {
    expect(castValue(5, 'string')).toBe('5')
    expect(castValue(true, 'string')).toBe('true')
    expect(castValue('hi', 'string')).toBe('hi')
    expect(castValue(new Date('2026-06-04T17:15:02.000Z'), 'string')).toBe('2026-06-04T17:15:02.000Z')
    expect(() => castValue([1], 'string')).toThrow(/Cannot cast/)
    expect(() => castValue({ a: 1 }, 'string')).toThrow(/Cannot cast/)
  })

  it('→ number: number passes, boolean 0/1, numeric string parses, else throws', () => {
    expect(castValue(42, 'number')).toBe(42)
    expect(castValue(true, 'number')).toBe(1)
    expect(castValue(false, 'number')).toBe(0)
    expect(castValue('3.14', 'number')).toBe(3.14)
    expect(() => castValue('abc', 'number')).toThrow(/not a numeric value/)
    expect(() => castValue([1], 'number')).toThrow(/Cannot cast/)
    expect(() => castValue(new Date(), 'number')).toThrow(/Cannot cast/)
  })

  it('→ boolean: truthiness for number, word-set for string (1/0/yes/no/on/off), else throws', () => {
    expect(castValue(false, 'boolean')).toBe(false)
    expect(castValue(1, 'boolean')).toBe(true)
    expect(castValue(0, 'boolean')).toBe(false)
    expect(castValue('TRUE', 'boolean')).toBe(true)
    expect(castValue('off', 'boolean')).toBe(false)
    expect(castValue('Yes', 'boolean')).toBe(true)
    expect(castValue('0', 'boolean')).toBe(false)
    expect(() => castValue('maybe', 'boolean')).toThrow(/expected true\/false/)
    expect(() => castValue([true], 'boolean')).toThrow(/Cannot cast/)
  })

  it('→ date: Date passes, ISO string parses, number/string epoch parses, else throws', () => {
    const d = new Date('2026-06-04T17:15:02.000Z')
    expect(castValue(d, 'date')).toBe(d)
    expect(castValue('2026-06-04T17:15:02.000Z', 'date')).toBeInstanceOf(Date)
    expect((castValue('2026-06-04', 'date') as Date).getFullYear()).toBe(2026)
    // number → date: epoch ms (≥ 1e12) and Unix seconds (< 1e12) both resolve.
    expect((castValue(1717520102000, 'date') as Date).toISOString()).toBe('2024-06-04T16:55:02.000Z')
    expect((castValue(1717520102, 'date') as Date).toISOString()).toBe('2024-06-04T16:55:02.000Z')
    // string → date from a bare epoch number too (seconds or ms).
    expect((castValue('1717520102000', 'date') as Date).toISOString()).toBe('2024-06-04T16:55:02.000Z')
    expect(() => castValue('not a date', 'date')).toThrow(/not a recognizable date or epoch/)
  })

  it('null / undefined source ALWAYS throws (every target)', () => {
    for (const t of SCENARIO_CAST_TYPES) {
      expect(() => castValue(null, t)).toThrow(/Cannot cast/)
      expect(() => castValue(undefined, t)).toThrow(/Cannot cast/)
    }
  })

  it('isScenarioCastType guards the union', () => {
    expect(isScenarioCastType('number')).toBe(true)
    expect(isScenarioCastType('list')).toBe(true)
    expect(isScenarioCastType('object')).toBe(false)
    expect(isScenarioCastType('')).toBe(false)
  })
})

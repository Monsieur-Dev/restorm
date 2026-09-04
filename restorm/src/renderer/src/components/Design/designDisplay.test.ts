import { describe, it, expect } from 'vitest'
import { bridgeEnumValues, displayValue, parseTypedValue } from './designDisplay'
import type { DesignProperty } from '../../../../shared/types/collections'

const prop = (type: string): DesignProperty => ({ id: 'p', doc: { name: 'n', type, required: false } })

describe('designDisplay', () => {
  it('displayValue renders primitives verbatim and objects as JSON', () => {
    expect(displayValue(undefined)).toBe('')
    expect(displayValue(null)).toBe('')
    expect(displayValue('x')).toBe('x')
    expect(displayValue(42)).toBe('42')
    expect(displayValue(false)).toBe('false')
    expect(displayValue({ a: 1 })).toBe('{"a":1}')
  })

  it('parseTypedValue round-trips numbers and booleans as their real JSON type', () => {
    expect(parseTypedValue(prop('integer'), '43')).toBe(43)
    expect(parseTypedValue(prop('number'), '3.5')).toBe(3.5)
    expect(parseTypedValue(prop('boolean'), 'true')).toBe(true)
    expect(parseTypedValue(prop('boolean'), 'false')).toBe(false)
    expect(parseTypedValue(prop('string'), '43')).toBe('43')
  })

  it('parseTypedValue keeps unparseable input as the typed string', () => {
    expect(parseTypedValue(prop('integer'), 'abc')).toBe('abc')
    expect(parseTypedValue(prop('boolean'), 'yes')).toBe('yes')
  })

  it('parseTypedValue restores structure for array/map values', () => {
    expect(parseTypedValue(prop('array'), '[1,2]')).toEqual([1, 2])
    expect(parseTypedValue(prop('map'), '{"k":"v"}')).toEqual({ k: 'v' })
    expect(parseTypedValue(prop('array'), 'not-json')).toBe('not-json')
  })

  it('a MODEL-referenced property parses its example as JSON; an enum reference stays a string', () => {
    const modelRef: DesignProperty = {
      id: 'p', doc: { name: 'customer', type: 'User', required: true },
      design: { reference: { target: 'model', refId: 'model-user' } }
    }
    expect(parseTypedValue(modelRef, '{"id":1}')).toEqual({ id: 1 })
    const enumRef: DesignProperty = {
      id: 'p', doc: { name: 'status', type: 'string', required: false },
      design: { reference: { target: 'enum', refId: 'enum-status' } }
    }
    expect(parseTypedValue(enumRef, 'active')).toBe('active')
  })

  it('displayValue → parseTypedValue is the identity on typed examples', () => {
    for (const [type, value] of [['integer', 42], ['boolean', true], ['string', 'x'], ['array', [1, 2]]] as const) {
      expect(parseTypedValue(prop(type), displayValue(value))).toEqual(value)
    }
  })

  describe('bridgeEnumValues — typed enum members survive every edit shape', () => {
    it('in-place edits and appends keep originals, new labels stay strings', () => {
      expect(bridgeEnumValues([1, 2, 3], ['1', '2', '3', '4'])).toEqual([1, 2, 3, '4'])
    })

    it('a DELETION keeps the survivors typed (the positional trap)', () => {
      expect(bridgeEnumValues([1, 2, 3], ['2', '3'])).toEqual([2, 3])
    })

    it('a REORDER keeps every member typed', () => {
      expect(bridgeEnumValues([1, 2, 3], ['3', '1', '2'])).toEqual([3, 1, 2])
    })

    it('blank rows are dropped, not stored', () => {
      expect(bridgeEnumValues(['a'], ['a', '  ', ''])).toEqual(['a'])
    })
  })
})

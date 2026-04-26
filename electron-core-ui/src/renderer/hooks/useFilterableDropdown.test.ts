import { describe, expect, it } from 'vitest'
import { applyDropdownFilter, DEFAULT_FILTER_THRESHOLD } from './useFilterableDropdown'

interface Item { value: string; label: string }

const stringId = (item: Item): string => item.label

describe('applyDropdownFilter', () => {
  const items: Item[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'gAmma' }
  ]

  it('returns the same array reference when the query is empty', () => {
    expect(applyDropdownFilter(items, '', stringId)).toBe(items)
  })

  it('returns the same array reference when the query is whitespace-only', () => {
    expect(applyDropdownFilter(items, '   ', stringId)).toBe(items)
  })

  it('case-insensitive substring match on the label', () => {
    // 'A' matches Alpha, Beta, gAmma (case-insensitive substring).
    expect(applyDropdownFilter(items, 'A', stringId).map((it) => it.value)).toEqual([
      'a',
      'b',
      'c'
    ])
    // More specific query: 'lph' matches only 'Alpha'.
    expect(applyDropdownFilter(items, 'lph', stringId).map((it) => it.value)).toEqual([
      'a'
    ])
  })

  it('preserves original order', () => {
    const ordered: Item[] = [
      { value: '1', label: 'orange' },
      { value: '2', label: 'banana' },
      { value: '3', label: 'apple' }
    ]
    expect(applyDropdownFilter(ordered, 'an', stringId).map((it) => it.value)).toEqual([
      '1', // orANge
      '2'  // bANana
    ])
  })

  it('coerces non-string labels through String()', () => {
    interface Mixed { value: string; label: unknown }
    const mixed: Mixed[] = [
      { value: 'n', label: 42 },
      { value: 'b', label: true },
      { value: 'u', label: undefined },
      { value: 's', label: 'searchable' }
    ]
    expect(applyDropdownFilter(mixed, 'search', (it) => it.label).map((it) => it.value)).toEqual(['s'])
    expect(applyDropdownFilter(mixed, '42', (it) => it.label).map((it) => it.value)).toEqual(['n'])
    // `undefined` labels round-trip to '' via the null guard, never crash.
    expect(applyDropdownFilter(mixed, 'undefined', (it) => it.label).map((it) => it.value)).toEqual([])
  })

  it('returns an empty array when nothing matches', () => {
    expect(applyDropdownFilter(items, 'zzzz', stringId)).toEqual([])
  })
})

describe('DEFAULT_FILTER_THRESHOLD', () => {
  it('exposes 15 as the default filter threshold', () => {
    expect(DEFAULT_FILTER_THRESHOLD).toBe(15)
  })
})

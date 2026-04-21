import { describe, it, expect } from 'vitest'
import { parseExpand, serializeExpand, type ExpandNode } from '../../src/shared/utils/odataExpand'

describe('parseExpand / serializeExpand', () => {
  it('parses a single property', () => {
    const out = parseExpand('Category')
    expect(out).toHaveLength(1)
    expect(out[0]?.property).toBe('Category')
    expect(out[0]?.select).toBeUndefined()
  })

  it('parses multiple top-level properties', () => {
    const out = parseExpand('Category,Tags')
    expect(out).toHaveLength(2)
    expect(out.map((n) => n.property)).toEqual(['Category', 'Tags'])
  })

  it('parses nested options ($select, $top, $filter)', () => {
    const out = parseExpand("Tags($select=Name;$top=5;$filter=Name eq 'x')")
    expect(out).toHaveLength(1)
    const node = out[0]
    expect(node?.property).toBe('Tags')
    expect(node?.select).toEqual(['Name'])
    expect(node?.top).toBe('5')
    expect(node?.filter).toBe("Name eq 'x'")
  })

  it('handles commas inside nested $filter without splitting', () => {
    const out = parseExpand("Tags($filter=contains(Name,'abc')),Owner")
    expect(out).toHaveLength(2)
    expect(out[0]?.property).toBe('Tags')
    expect(out[0]?.filter).toBe("contains(Name,'abc')")
    expect(out[1]?.property).toBe('Owner')
  })

  it('parses recursive $expand', () => {
    const out = parseExpand('Owner($expand=Company($select=Name))')
    expect(out[0]?.expand).toHaveLength(1)
    expect(out[0]?.expand?.[0]?.property).toBe('Company')
    expect(out[0]?.expand?.[0]?.select).toEqual(['Name'])
  })

  it('round-trips a complex clause', () => {
    const original = 'Category,Tags($select=Name;$top=5),Owner($expand=Company($select=Name))'
    const parsed = parseExpand(original)
    expect(serializeExpand(parsed)).toBe(original)
  })

  it('returns empty for undefined / empty input', () => {
    expect(parseExpand(undefined)).toEqual([])
    expect(parseExpand('')).toEqual([])
  })

  it('drops property-less nodes on serialize', () => {
    const nodes: ExpandNode[] = [
      { id: '1', property: '', select: ['Name'] },
      { id: '2', property: 'Tags' }
    ]
    expect(serializeExpand(nodes)).toBe('Tags')
  })

  it('preserves handlebars templates in nested options', () => {
    const out = parseExpand('Tags($top={{pageSize}})')
    expect(out[0]?.top).toBe('{{pageSize}}')
    expect(serializeExpand(out)).toBe('Tags($top={{pageSize}})')
  })
})

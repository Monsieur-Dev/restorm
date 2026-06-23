/**
 * Unit tests for the OData `$filter` tokenizer + cursor classifier.
 * These pin the position-classification logic the Monaco completion
 * provider relies on, without loading Monaco (fragile in jsdom).
 */
import { describe, it, expect } from 'vitest'
import {
  tokenizeFilter,
  classifyCursor,
  type FilterToken
} from '../../src/shared/utils/odataFilter/odataFilterGrammar'

function types(tokens: FilterToken[]): string[] {
  return tokens.filter((t) => t.type !== 'whitespace').map((t) => t.type)
}

describe('tokenizeFilter', () => {
  it('tokenises a simple comparison', () => {
    const t = tokenizeFilter("Name eq 'Alice'")
    expect(types(t)).toEqual(['identifier', 'operator', 'string'])
  })

  it('classifies and/or as logical', () => {
    const t = tokenizeFilter("Name eq 'A' and Age gt 21")
    expect(types(t)).toEqual([
      'identifier', 'operator', 'string',
      'logical',
      'identifier', 'operator', 'number'
    ])
  })

  it('recognises a function name followed by paren', () => {
    const t = tokenizeFilter("startswith(Name,'A')")
    expect(t[0]?.type).toBe('function')
  })

  it('does not treat a bare identifier named like a function as a function', () => {
    // `length` without a following paren is a plain identifier
    const t = tokenizeFilter('length eq 3')
    expect(t[0]?.type).toBe('identifier')
  })

  it('treats {{env.var}} as one opaque template token', () => {
    const t = tokenizeFilter("Name eq {{userName}}")
    const tmpl = t.find((x) => x.type === 'template')
    expect(tmpl?.value).toBe('{{userName}}')
  })

  it('keeps a navigation path as identifier / slash / identifier', () => {
    const t = tokenizeFilter('Customer/Name eq 5')
    expect(types(t)).toEqual(['identifier', 'slash', 'identifier', 'operator', 'number'])
  })

  it('lexes a guid literal', () => {
    const t = tokenizeFilter('Id eq 12345678-1234-1234-1234-123456789abc')
    expect(t.find((x) => x.type === 'guid')).toBeTruthy()
  })

  it('lexes an ISO datetime literal', () => {
    const t = tokenizeFilter('Created gt 2024-01-01T00:00:00Z')
    expect(t.find((x) => x.type === 'datetime')).toBeTruthy()
  })

  it('lexes true/false/null as keywords', () => {
    expect(tokenizeFilter('A eq true').find((x) => x.type === 'keyword')?.value).toBe('true')
    expect(tokenizeFilter('A eq null').find((x) => x.type === 'keyword')?.value).toBe('null')
  })

  it('handles an escaped quote inside a string', () => {
    const t = tokenizeFilter("Name eq 'O''Brien'")
    const str = t.find((x) => x.type === 'string')
    expect(str?.value).toBe("'O''Brien'")
  })
})

describe('classifyCursor', () => {
  it('empty input → property position', () => {
    expect(classifyCursor('', 0).kind).toBe('property')
  })

  it('mid-property word → property position with prefix', () => {
    const c = classifyCursor('Sta', 3)
    expect(c.kind).toBe('property')
    expect(c.prefix).toBe('Sta')
  })

  it('after a property + space → operator position', () => {
    const c = classifyCursor('Name ', 5)
    expect(c.kind).toBe('operator')
    expect(c.propertyPath).toBe('Name')
  })

  it('after a comparison operator → value position, reports property', () => {
    const c = classifyCursor("Name eq ", 8)
    expect(c.kind).toBe('value')
    expect(c.propertyPath).toBe('Name')
  })

  it('value position for an enum property reports its path', () => {
    const c = classifyCursor('Status eq ', 10)
    expect(c.kind).toBe('value')
    expect(c.propertyPath).toBe('Status')
  })

  it('after a complete value → logical position', () => {
    const c = classifyCursor("Name eq 'Alice' ", 16)
    expect(c.kind).toBe('logical')
  })

  it('after "and" → property position again', () => {
    const c = classifyCursor("Name eq 'A' and ", 16)
    expect(c.kind).toBe('property')
  })

  it('after an opening paren → property position', () => {
    const c = classifyCursor('(', 1)
    expect(c.kind).toBe('property')
  })

  it('navigation path: after Customer/ → property position', () => {
    const c = classifyCursor('Customer/', 9)
    expect(c.kind).toBe('property')
  })

  it('operator position reports the full navigation path', () => {
    const c = classifyCursor('Customer/Name ', 14)
    expect(c.kind).toBe('operator')
    expect(c.propertyPath).toBe('Customer/Name')
  })

  it('cursor inside a {{template}} span → inTemplate, no OData completion', () => {
    const text = 'Name eq {{userName}}'
    const offset = text.indexOf('userName') + 2
    const c = classifyCursor(text, offset)
    expect(c.inTemplate).toBe(true)
    expect(c.kind).toBe('unknown')
  })

  it('after a {{template}} value → logical position', () => {
    const text = 'Name eq {{u}} '
    const c = classifyCursor(text, text.length)
    expect(c.kind).toBe('logical')
  })

  it('mid-operator word classifies as operator with prefix', () => {
    const c = classifyCursor('Name e', 6)
    expect(c.kind).toBe('operator')
    expect(c.prefix).toBe('e')
  })
})

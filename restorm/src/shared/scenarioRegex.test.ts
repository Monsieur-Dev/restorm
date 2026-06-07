import { describe, it, expect } from 'vitest'
import { applyRegex, isRegexOp, REGEX_OPS } from './scenarioRegex'

describe('scenarioRegex — the one regex core (runtime + preview)', () => {
  it('extract: whole match, first capture group, or named-groups object', () => {
    expect(applyRegex('order #12345 shipped', 'extract', '#(\\d+)')).toBe('12345') // first group
    expect(applyRegex('hello world', 'extract', '\\w+')).toBe('hello') // whole match, no group
    expect(applyRegex('2026-06-05', 'extract', '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})'))
      .toEqual({ y: '2026', m: '06', d: '05' }) // named groups
    expect(applyRegex('nope', 'extract', '#(\\d+)')).toBeNull() // no match → null
  })

  it('extractAll: a list of matches/groups/objects (global)', () => {
    expect(applyRegex('a1 b2 c3', 'extractAll', '[a-z](\\d)')).toEqual(['1', '2', '3'])
    expect(applyRegex('cat hat bat', 'extractAll', '\\w+')).toEqual(['cat', 'hat', 'bat'])
    expect(applyRegex('k=1;k=2', 'extractAll', '(?<key>\\w)=(?<val>\\d)'))
      .toEqual([{ key: 'k', val: '1' }, { key: 'k', val: '2' }])
    expect(applyRegex('nothing', 'extractAll', '\\d+')).toEqual([])
  })

  it('test: boolean match', () => {
    expect(applyRegex('abc123', 'test', '\\d+')).toBe(true)
    expect(applyRegex('abc', 'test', '\\d+')).toBe(false)
    expect(applyRegex('ABC', 'test', 'abc', 'i')).toBe(true) // flags honoured
  })

  it('replace: all matches, with $1 / $<name> support; no match → unchanged', () => {
    expect(applyRegex('a1 b2', 'replace', '\\d', '', '#')).toBe('a# b#') // global by default
    expect(applyRegex('John Smith', 'replace', '(\\w+) (\\w+)', '', '$2 $1')).toBe('Smith John')
    expect(applyRegex('2026-06-05', 'replace', '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})', '', '$<d>/$<m>/$<y>'))
      .toBe('05/06/2026')
    expect(applyRegex('no digits', 'replace', '\\d', '', '#')).toBe('no digits')
  })

  it('split: pieces by the pattern', () => {
    expect(applyRegex('a, b ,c,  d', 'split', '\\s*,\\s*')).toEqual(['a', 'b', 'c', 'd'])
    expect(applyRegex('one', 'split', ',')).toEqual(['one'])
  })

  it('coerces a non-string value and treats null/undefined as ""', () => {
    expect(applyRegex(12345, 'extract', '\\d+')).toBe('12345')
    expect(applyRegex(null, 'test', '\\d')).toBe(false)
  })

  it('THROWS on an invalid pattern (→ error port) for every op', () => {
    for (const op of REGEX_OPS) {
      expect(() => applyRegex('x', op, '(unclosed')).toThrow()
    }
  })

  it('isRegexOp guards the union', () => {
    expect(isRegexOp('replace')).toBe(true)
    expect(isRegexOp('matchAll')).toBe(false)
  })
})

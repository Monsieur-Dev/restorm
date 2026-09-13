import { describe, it, expect } from 'vitest'
import { compileFilters, compileFilterList, passesFilters, isValidFilterPattern } from '../../src/shared/recording/captureFilters'

describe('capture filters — white / black list semantics', () => {
  const url = 'http://localhost:8080/api/swagger.json'

  it('an empty configuration keeps everything', () => {
    expect(passesFilters(url, compileFilters([], []))).toBe(true)
  })

  it('the white list is an OR: one matching entry is enough', () => {
    const filters = compileFilters(['/nothing/', '/api/'], [])
    expect(passesFilters(url, filters)).toBe(true)
    expect(passesFilters('http://localhost:8080/index.html', filters)).toBe(false)
  })

  it('the black list drops on any match', () => {
    expect(passesFilters(url, compileFilters([], ['\\.json$']))).toBe(false)
    expect(passesFilters(url, compileFilters([], ['\\.png$']))).toBe(true)
  })

  it('the black list has the last word over the white list', () => {
    expect(passesFilters(url, compileFilters(['/api/'], ['swagger']))).toBe(false)
  })

  it('ignores blank entries and reports the ones that do not compile', () => {
    const compiled = compileFilterList(['', '  ', '/api/', '(', 'ok['])
    expect(compiled.regexes).toHaveLength(1)
    expect(compiled.invalid).toEqual([3, 4])
    // An invalid black entry cannot drop, an invalid white entry cannot gate.
    expect(passesFilters(url, compileFilters(['('], []))).toBe(true)
    expect(passesFilters(url, compileFilters([], ['(']))).toBe(true)
  })

  it('validates a single pattern for the config table', () => {
    expect(isValidFilterPattern('^https?://')).toBe(true)
    expect(isValidFilterPattern('')).toBe(true)
    expect(isValidFilterPattern('[')).toBe(false)
  })
})

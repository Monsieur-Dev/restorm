import { describe, it, expect } from 'vitest'
import { applyCsv, isCsvOp } from './scenarioCsv'

describe('applyCsv', () => {
  it('parses with a header into row-objects', () => {
    expect(applyCsv('id,name\n1,Rex\n2,Fido', 'parse')).toEqual([
      { id: '1', name: 'Rex' },
      { id: '2', name: 'Fido' }
    ])
  })

  it('parses without a header into cell arrays', () => {
    expect(applyCsv('1,Rex\n2,Fido', 'parse', { header: false })).toEqual([
      ['1', 'Rex'],
      ['2', 'Fido']
    ])
  })

  it('honours quotes (embedded delimiter, newline, escaped quote)', () => {
    expect(applyCsv('a,b\n"x,y","line1\nline2"\n"he said ""hi""",z', 'parse')).toEqual([
      { a: 'x,y', b: 'line1\nline2' },
      { a: 'he said "hi"', b: 'z' }
    ])
  })

  it('handles a custom delimiter + CRLF', () => {
    expect(applyCsv('id;name\r\n1;Rex', 'parse', { delimiter: ';' })).toEqual([{ id: '1', name: 'Rex' }])
  })

  it('stringifies a list of objects (header from the key union)', () => {
    expect(applyCsv([{ id: 1, name: 'Rex' }, { id: 2, name: 'Fido' }], 'stringify')).toBe('id,name\n1,Rex\n2,Fido')
  })

  it('stringifies a list of arrays as rows', () => {
    expect(applyCsv([['a', 'b'], ['1', '2']], 'stringify')).toBe('a,b\n1,2')
  })

  it('quotes cells that need it on stringify', () => {
    expect(applyCsv([{ a: 'x,y', b: 'he "said"' }], 'stringify')).toBe('a,b\n"x,y","he ""said"""')
  })

  it('round-trips objects', () => {
    const rows = [{ id: '1', name: 'Rex' }, { id: '2', name: 'Fido, Jr' }]
    expect(applyCsv(applyCsv(rows, 'stringify'), 'parse')).toEqual(rows)
  })

  it('throws on the wrong operand shape', () => {
    expect(() => applyCsv(42, 'parse')).toThrow()
    expect(() => applyCsv('not a list', 'stringify')).toThrow()
  })

  it('isCsvOp guards', () => {
    expect(isCsvOp('parse')).toBe(true)
    expect(isCsvOp('nope')).toBe(false)
  })
})

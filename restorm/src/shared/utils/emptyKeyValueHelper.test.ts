import { describe, it, expect } from 'vitest'
import { isKeyValueValueEmpty, disableEmptyKeyValues } from './emptyKeyValueHelper'
import { StringValue, PasswordValue, NumericValue, BooleanValue, ExpressionValue } from '../types/collections'

describe('isKeyValueValueEmpty', () => {
  it('treats StringValue("") as empty', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new StringValue('') })).toBe(true)
  })

  it('treats whitespace-only StringValue as empty', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new StringValue('   ') })).toBe(true)
  })

  it('treats StringValue with content as non-empty', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new StringValue('hello') })).toBe(false)
  })

  it('treats PasswordValue("") as empty', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new PasswordValue('') })).toBe(true)
  })

  it('treats NumericValue(0) as non-empty (toString() => "0")', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new NumericValue(0, 'decimal') })).toBe(false)
  })

  it('treats BooleanValue(false) as non-empty (toString() => "false")', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new BooleanValue(false) })).toBe(false)
  })

  it('treats empty ExpressionValue as empty', () => {
    expect(isKeyValueValueEmpty({ key: 'k', value: new ExpressionValue('') })).toBe(true)
  })
})

describe('disableEmptyKeyValues', () => {
  it('flips enabled to false on rows whose value resolves to empty', () => {
    const rows = [
      { key: 'name', value: new StringValue(''), enabled: true },
      { key: 'min_level', value: new StringValue('1'), enabled: true }
    ]
    disableEmptyKeyValues(rows)
    expect(rows[0]?.enabled).toBe(false)
    expect(rows[1]?.enabled).toBe(true)
  })

  it('leaves non-empty rows untouched (preserves existing enabled)', () => {
    const rows = [
      { key: 'k1', value: new StringValue('v1'), enabled: false },
      { key: 'k2', value: new StringValue('v2'), enabled: true }
    ]
    disableEmptyKeyValues(rows)
    expect(rows[0]?.enabled).toBe(false)
    expect(rows[1]?.enabled).toBe(true)
  })

  it('no-ops on undefined arrays (optional pathParams etc.)', () => {
    expect(() => { disableEmptyKeyValues(undefined) }).not.toThrow()
  })

  it('treats numeric 0 as non-empty — no auto-disable', () => {
    const rows = [
      { key: 'page', value: new NumericValue(0, 'decimal'), enabled: true }
    ]
    disableEmptyKeyValues(rows)
    expect(rows[0]?.enabled).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { castValueToKind, resolveValueTypeKind } from './castValue'
import {
  StringValue,
  ColorValue,
  DateTimeValue,
  NumericValue,
  PasswordValue,
  ExpressionValue,
  BooleanValue,
  EnumValue,
  EnumListValue,
  CustomListValue,
  CustomListMultiValue,
  NullValue
} from '../../../../shared/types/collections'
import type { CustomValueList } from '../../../../shared/types/collections'

describe('resolveValueTypeKind', () => {
  it('maps every concrete ValueType to its kind', () => {
    expect(resolveValueTypeKind(new StringValue('x'))).toBe('string')
    expect(resolveValueTypeKind(new PasswordValue('x'))).toBe('secret')
    expect(resolveValueTypeKind(new NumericValue(1, 'decimal'))).toBe('number')
    expect(resolveValueTypeKind(new DateTimeValue(new Date(), 'iso'))).toBe('dateTime')
    expect(resolveValueTypeKind(new ColorValue('#fff'))).toBe('color')
    expect(resolveValueTypeKind(new ExpressionValue('{{x}}'))).toBe('expression')
    expect(resolveValueTypeKind(new BooleanValue(true))).toBe('boolean')
    expect(resolveValueTypeKind(new EnumValue('a', 'def1'))).toBe('enum')
    expect(resolveValueTypeKind(new EnumListValue(['a'], 'def1'))).toBe('enumList')
    expect(resolveValueTypeKind(new CustomListValue('list1', 'a'))).toBe('customList')
    expect(resolveValueTypeKind(new CustomListMultiValue('list1', ['a']))).toBe('customListMulti')
  })

  it('defaults to string for undefined', () => {
    expect(resolveValueTypeKind(undefined)).toBe('string')
  })

  it('maps NullValue to `null`', () => {
    expect(resolveValueTypeKind(new NullValue())).toBe('null')
  })
})

const lists: CustomValueList[] = [
  {
    id: 'list1',
    name: 'Colours',
    entries: [
      { id: 'e1', label: 'red', value: '#f00', enabled: true },
      { id: 'e2', label: 'green', value: '#0f0', enabled: true },
      { id: 'e3', label: 'hidden', value: '#000', enabled: false }
    ]
  }
]

describe('castValueToKind', () => {
  it('casts to string seeded from current toString', () => {
    const next = castValueToKind(new NumericValue(42, 'decimal'), 'string')
    expect(next).toBeInstanceOf(StringValue)
    expect(next.toString()).toBe('42')
  })

  it('casts to secret', () => {
    const next = castValueToKind(new StringValue('s3cr3t'), 'secret')
    expect(next).toBeInstanceOf(PasswordValue)
    expect((next as PasswordValue).value).toBe('s3cr3t')
  })

  it('casts to number, parsing the seed', () => {
    const ok = castValueToKind(new StringValue('17'), 'number')
    expect(ok).toBeInstanceOf(NumericValue)
    expect((ok as NumericValue).value).toBe(17)

    const bad = castValueToKind(new StringValue('not-a-number'), 'number')
    expect((bad as NumericValue).value).toBe(0)
  })

  it('casts to dateTime', () => {
    const next = castValueToKind(new StringValue('2024-01-02 03:04:05'), 'dateTime')
    expect(next).toBeInstanceOf(DateTimeValue)
    expect((next as DateTimeValue).format).toBe('yyyy-MM-dd HH:mm:ss')
  })

  it('casts to color, keeping a hex seed and defaulting otherwise', () => {
    expect((castValueToKind(new StringValue('#abcdef'), 'color') as ColorValue).value).toBe('#abcdef')
    expect((castValueToKind(new StringValue('nope'), 'color') as ColorValue).value).toBe('#000000')
  })

  it('casts to expression', () => {
    const next = castValueToKind(new StringValue('{{x}}'), 'expression')
    expect(next).toBeInstanceOf(ExpressionValue)
    expect((next as ExpressionValue).value).toBe('{{x}}')
  })

  it('casts to boolean from truthy seeds', () => {
    expect((castValueToKind(new StringValue('true'), 'boolean') as BooleanValue).value).toBe(true)
    expect((castValueToKind(new StringValue('1'), 'boolean') as BooleanValue).value).toBe(true)
    expect((castValueToKind(new StringValue('false'), 'boolean') as BooleanValue).value).toBe(false)
  })

  it('casts to enum with the def id', () => {
    const next = castValueToKind(new StringValue('a'), 'enum', 'def1')
    expect(next).toBeInstanceOf(EnumValue)
    expect((next as EnumValue).value).toBe('a')
    expect((next as EnumValue).enumDefinitionId).toBe('def1')
  })

  it('casts to enumList splitting the seed', () => {
    const next = castValueToKind(new StringValue('a, b ,c'), 'enumList', 'def1')
    expect(next).toBeInstanceOf(EnumListValue)
    expect((next as EnumListValue).value).toEqual(['a', 'b', 'c'])
    expect((next as EnumListValue).enumDefinitionId).toBe('def1')
  })

  it('casts to customList keeping the current label when still enabled', () => {
    const next = castValueToKind(new StringValue('green'), 'customList', 'list1', lists)
    expect(next).toBeInstanceOf(CustomListValue)
    expect((next as CustomListValue).listId).toBe('list1')
    expect((next as CustomListValue).label).toBe('green')
  })

  it('casts to customList defaulting to first enabled entry when label not enabled', () => {
    const fromDisabled = castValueToKind(new StringValue('hidden'), 'customList', 'list1', lists)
    expect((fromDisabled as CustomListValue).label).toBe('red')

    const fromUnknown = castValueToKind(new StringValue('purple'), 'customList', 'list1', lists)
    expect((fromUnknown as CustomListValue).label).toBe('red')
  })

  it('casts to customListMulti keeping only still-enabled labels', () => {
    const next = castValueToKind(new StringValue('red, hidden, green'), 'customListMulti', 'list1', lists)
    expect(next).toBeInstanceOf(CustomListMultiValue)
    expect((next as CustomListMultiValue).listId).toBe('list1')
    expect((next as CustomListMultiValue).labels).toEqual(['red', 'green'])
  })
})

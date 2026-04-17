import { describe, it, expect } from 'vitest'
import { KeyValue } from '../../src/shared/models'
import {
  StringValue,
  ColorValue,
  DateTimeValue,
  NumericValue,
  PasswordValue,
  ExpressionValue,
  BooleanValue,
  EnumValue,
  EnumListValue
} from '../../src/shared/types/collections'
import {
  isColorValue,
  isDateTimeValue,
  isNumericValue,
  isPasswordValue,
  isExpressionValue,
  isBooleanValue,
  isEnumValue,
  isEnumListValue
} from '../../src/shared/utils/valueHelpers'
import { serializeValueForPersistence } from '../../src/shared/utils/valuePersistence'

describe('ValueType serialization round-trips', () => {
  const cases: { name: string; value: InstanceType<typeof StringValue | typeof ColorValue | typeof DateTimeValue | typeof NumericValue | typeof PasswordValue | typeof ExpressionValue | typeof BooleanValue | typeof EnumValue | typeof EnumListValue>; expectedType: string }[] = [
    { name: 'StringValue', value: new StringValue('hello'), expectedType: 'string' },
    { name: 'ColorValue', value: new ColorValue('#ff0000'), expectedType: 'color' },
    { name: 'NumericValue', value: new NumericValue(42, 'decimal'), expectedType: 'numeric' },
    { name: 'PasswordValue', value: new PasswordValue(''), expectedType: 'password' },
    { name: 'ExpressionValue', value: new ExpressionValue('{{scheme}}://{{host}}'), expectedType: 'expression' },
    { name: 'BooleanValue', value: new BooleanValue(true), expectedType: 'boolean' },
    { name: 'EnumValue', value: new EnumValue('available', 'status-enum-id'), expectedType: 'enum' },
    { name: 'EnumListValue', value: new EnumListValue(['a', 'b'], 'multi-enum-id'), expectedType: 'enumList' }
  ]

  for (const { name, value, expectedType } of cases) {
    it(`${name} serializes and deserializes correctly`, () => {
      // Serialize
      const serialized = serializeValueForPersistence(value)
      expect(serialized).toBeDefined()
      expect((serialized as { type: string }).type).toBe(expectedType)

      // Deserialize via KeyValue.fromPlain
      const kv = KeyValue.fromPlain({ key: 'test', value: serialized })
      expect(kv.value.type).toBe(expectedType)
      expect(kv.value.toString()).toBe(value.toString())
    })
  }

  it('DateTimeValue serializes and deserializes correctly', () => {
    const date = new Date('2026-01-15T10:30:00Z')
    const value = new DateTimeValue(date, 'yyyy-MM-dd')
    const serialized = serializeValueForPersistence(value)
    expect((serialized as { type: string }).type).toBe('datetime')

    const kv = KeyValue.fromPlain({ key: 'test', value: serialized })
    expect(kv.value.type).toBe('datetime')
    expect(kv.value instanceof DateTimeValue).toBe(true)
  })
})

describe('valueHelpers type guards', () => {
  it('isExpressionValue detects ExpressionValue instances', () => {
    expect(isExpressionValue(new ExpressionValue('{{x}}'))).toBe(true)
    expect(isExpressionValue(new StringValue('{{x}}'))).toBe(false)
  })

  it('isExpressionValue detects plain objects with type property (proxy fallback)', () => {
    const proxy = { type: 'expression', value: '{{x}}', toString: () => '{{x}}' }
    expect(isExpressionValue(proxy as unknown as ExpressionValue)).toBe(true)
  })

  it('isBooleanValue detects BooleanValue instances', () => {
    expect(isBooleanValue(new BooleanValue(true))).toBe(true)
    expect(isBooleanValue(new StringValue('true'))).toBe(false)
  })

  it('isEnumValue detects EnumValue instances', () => {
    expect(isEnumValue(new EnumValue('x', 'id'))).toBe(true)
    expect(isEnumValue(new StringValue('x'))).toBe(false)
  })

  it('isEnumListValue detects EnumListValue instances', () => {
    expect(isEnumListValue(new EnumListValue(['a'], 'id'))).toBe(true)
    expect(isEnumListValue(new EnumValue('a', 'id'))).toBe(false)
  })

  it('all type guards return false for wrong types', () => {
    const str = new StringValue('test')
    expect(isColorValue(str)).toBe(false)
    expect(isDateTimeValue(str)).toBe(false)
    expect(isNumericValue(str)).toBe(false)
    expect(isPasswordValue(str)).toBe(false)
    expect(isExpressionValue(str)).toBe(false)
    expect(isBooleanValue(str)).toBe(false)
    expect(isEnumValue(str)).toBe(false)
    expect(isEnumListValue(str)).toBe(false)
  })
})

describe('KeyValue.fromPlain preserves ExpressionValue through reactive proxy simulation', () => {
  it('reconstructs ExpressionValue from a plain object with type: expression', () => {
    // Simulate what happens when a value passes through IPC/structured clone
    const plainValue = { type: 'expression', value: '{{scheme}}://{{host}}:{{port}}' }
    const kv = KeyValue.fromPlain({ key: 'baseUrl', value: plainValue })
    expect(kv.value instanceof ExpressionValue).toBe(true)
    expect(kv.value.toString()).toBe('{{scheme}}://{{host}}:{{port}}')
    expect(isExpressionValue(kv.value)).toBe(true)
  })

  it('StringValue with Handlebars syntax is NOT treated as ExpressionValue', () => {
    const kv = KeyValue.fromPlain({ key: 'test', value: { type: 'string', value: '{{unresolved}}' } })
    expect(kv.value instanceof StringValue).toBe(true)
    expect(isExpressionValue(kv.value)).toBe(false)
    expect(kv.value.toString()).toBe('{{unresolved}}')
  })
})

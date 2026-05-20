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
  EnumListValue,
  CustomListValue,
  CustomListMultiValue
} from '../../src/shared/types/collections'
import {
  isColorValue,
  isDateTimeValue,
  isNumericValue,
  isPasswordValue,
  isExpressionValue,
  isBooleanValue,
  isEnumValue,
  isEnumListValue,
  isCustomListValue,
  isCustomListMultiValue
} from '../../src/shared/utils/valueHelpers'
import { serializeValueForPersistence } from '../../src/shared/utils/valuePersistence'

describe('ValueType serialization round-trips', () => {
  const cases: { name: string; value: InstanceType<typeof StringValue | typeof ColorValue | typeof DateTimeValue | typeof NumericValue | typeof PasswordValue | typeof ExpressionValue | typeof BooleanValue | typeof EnumValue | typeof EnumListValue | typeof CustomListValue | typeof CustomListMultiValue>; expectedType: string }[] = [
    { name: 'StringValue', value: new StringValue('hello'), expectedType: 'string' },
    { name: 'ColorValue', value: new ColorValue('#ff0000'), expectedType: 'color' },
    { name: 'NumericValue', value: new NumericValue(42, 'decimal'), expectedType: 'numeric' },
    { name: 'PasswordValue', value: new PasswordValue(''), expectedType: 'password' },
    { name: 'ExpressionValue', value: new ExpressionValue('{{scheme}}://{{host}}'), expectedType: 'expression' },
    { name: 'BooleanValue', value: new BooleanValue(true), expectedType: 'boolean' },
    { name: 'EnumValue', value: new EnumValue('available', 'status-enum-id'), expectedType: 'enum' },
    { name: 'EnumListValue', value: new EnumListValue(['a', 'b'], 'multi-enum-id'), expectedType: 'enumList' },
    { name: 'CustomListValue', value: new CustomListValue('couleur-list-id', 'Rouge'), expectedType: 'customList' },
    { name: 'CustomListMultiValue', value: new CustomListMultiValue('couleur-list-id', ['Rouge', 'Vert']), expectedType: 'customListMulti' }
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

  it('CustomListValue preserves listId + label through persistence', () => {
    const value = new CustomListValue('couleur-list-id', 'Rouge')
    const serialized = serializeValueForPersistence(value)
    expect(serialized).toEqual({ type: 'customList', listId: 'couleur-list-id', label: 'Rouge' })

    const kv = KeyValue.fromPlain({ key: 'test', value: serialized })
    expect(kv.value instanceof CustomListValue).toBe(true)
    expect((kv.value as CustomListValue).listId).toBe('couleur-list-id')
    expect((kv.value as CustomListValue).label).toBe('Rouge')
  })

  it('CustomListMultiValue preserves listId + labels through persistence', () => {
    const value = new CustomListMultiValue('couleur-list-id', ['Rouge', 'Vert'])
    const serialized = serializeValueForPersistence(value)
    expect(serialized).toEqual({ type: 'customListMulti', listId: 'couleur-list-id', labels: ['Rouge', 'Vert'] })

    const kv = KeyValue.fromPlain({ key: 'test', value: serialized })
    expect(kv.value instanceof CustomListMultiValue).toBe(true)
    expect((kv.value as CustomListMultiValue).listId).toBe('couleur-list-id')
    expect((kv.value as CustomListMultiValue).labels).toEqual(['Rouge', 'Vert'])
    expect(isCustomListMultiValue(kv.value)).toBe(true)
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

  it('isCustomListValue detects CustomListValue instances + proxy fallback', () => {
    expect(isCustomListValue(new CustomListValue('list', 'Rouge'))).toBe(true)
    expect(isCustomListValue(new EnumValue('a', 'id'))).toBe(false)
    const proxy = { type: 'customList', listId: 'list', label: 'Rouge', toString: () => 'Rouge' }
    expect(isCustomListValue(proxy as unknown as CustomListValue)).toBe(true)
    // The multi variant must not be misdetected as the single variant.
    expect(isCustomListValue(new CustomListMultiValue('list', ['Rouge']))).toBe(false)
  })

  it('isCustomListMultiValue detects CustomListMultiValue instances + proxy fallback', () => {
    expect(isCustomListMultiValue(new CustomListMultiValue('list', ['Rouge', 'Vert']))).toBe(true)
    expect(isCustomListMultiValue(new CustomListValue('list', 'Rouge'))).toBe(false)
    const proxy = { type: 'customListMulti', listId: 'list', labels: ['Rouge'], toString: () => 'Rouge' }
    expect(isCustomListMultiValue(proxy as unknown as CustomListMultiValue)).toBe(true)
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

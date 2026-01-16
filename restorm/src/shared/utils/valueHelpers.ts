/**
 * Helper functions for working with Value types
 */

import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue, type ValueType } from '../types/collections'

/**
 * Convert a ValueType to a string using its toString() method
 */
export function valueToString(value: ValueType): string {
  return value.toString()
}

/**
 * Create a StringValue from a string (backward compatibility helper)
 */
export function stringToValue(str: string): StringValue {
  return new StringValue(str)
}

/**
 * Convert a KeyValue's value to string (helper for backward compatibility)
 */
export function keyValueValueToString(kv: { value: ValueType }): string {
  return kv.value.toString()
}

/**
 * Check if a value is a StringValue
 */
export function isStringValue(value: ValueType): value is StringValue {
  return value instanceof StringValue || (value as { type?: string }).type === 'string'
}

/**
 * Check if a value is a ColorValue
 */
export function isColorValue(value: ValueType): value is ColorValue {
  return value instanceof ColorValue || (value as { type?: string }).type === 'color'
}

/**
 * Check if a value is a DateTimeValue
 */
export function isDateTimeValue(value: ValueType): value is DateTimeValue {
  return value instanceof DateTimeValue || (value as { type?: string }).type === 'datetime'
}

/**
 * Check if a value is a NumericValue
 */
export function isNumericValue(value: ValueType): value is NumericValue {
  return value instanceof NumericValue || (value as { type?: string }).type === 'numeric'
}

/**
 * Check if a value is a PasswordValue
 */
export function isPasswordValue(value: ValueType): value is PasswordValue {
  return value instanceof PasswordValue || (value as { type?: string }).type === 'password'
}

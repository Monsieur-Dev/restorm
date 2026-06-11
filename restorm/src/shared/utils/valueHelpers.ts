/**
 * Helper functions for working with Value types
 */

import { StringValue, ColorValue, DateTimeValue, NumericValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue, VariableValue, EnvironmentValue, NullValue, ListValue, type ValueType } from '../types/collections'
import { SecretValue } from '../types/valueTypes/SecretValue'

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
 * Check if a value is an ExpressionValue (Handlebars template).
 */
export function isExpressionValue(value: ValueType): value is ExpressionValue {
  return value instanceof ExpressionValue || (value as { type?: string }).type === 'expression'
}

/**
 * Check if a value is a VariableValue (a reference to a scenario variable).
 */
export function isVariableValue(value: ValueType): value is VariableValue {
  return value instanceof VariableValue || (value as { type?: string }).type === 'variable'
}

/**
 * Check if a value is an EnvironmentValue (a reference to an environment by id).
 */
export function isEnvironmentValue(value: ValueType): value is EnvironmentValue {
  return value instanceof EnvironmentValue || (value as { type?: string }).type === 'environment'
}

/**
 * Check if a value is a BooleanValue.
 */
export function isBooleanValue(value: ValueType): value is BooleanValue {
  return value instanceof BooleanValue || (value as { type?: string }).type === 'boolean'
}

/**
 * Check if a value is the explicit NullValue (a deliberate "no value").
 */
export function isNullValue(value: ValueType): value is NullValue {
  return value instanceof NullValue || (value as { type?: string }).type === 'null'
}

/** Check if a value is a ListValue (an agnostic, untyped list of values). */
export function isListValue(value: ValueType): value is ListValue {
  return value instanceof ListValue || (value as { type?: string }).type === 'list'
}

/**
 * Check if a value is an EnumValue (single-select from a closed list).
 */
export function isEnumValue(value: ValueType): value is EnumValue {
  return value instanceof EnumValue || (value as { type?: string }).type === 'enum'
}

/**
 * Check if a value is an EnumListValue (multi-select from a closed list).
 */
export function isEnumListValue(value: ValueType): value is EnumListValue {
  return value instanceof EnumListValue || (value as { type?: string }).type === 'enumList'
}

/**
 * Check if a value is a CustomListValue (a label picked from a
 * user-defined custom value list on the env folder).
 */
export function isCustomListValue(value: ValueType): value is CustomListValue {
  return value instanceof CustomListValue || (value as { type?: string }).type === 'customList'
}

/**
 * Check if a value is a CustomListMultiValue (multi-select of labels
 * from a user-defined custom value list on the env folder).
 */
export function isCustomListMultiValue(value: ValueType): value is CustomListMultiValue {
  return value instanceof CustomListMultiValue || (value as { type?: string }).type === 'customListMulti'
}

/**
 * Check if a value is a SecretValue (resolved at run time from a named source).
 */
export function isSecretValue(value: ValueType): value is SecretValue {
  return value instanceof SecretValue || (value as { type?: string }).type === 'secret'
}

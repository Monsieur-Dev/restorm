import { KeyValue } from '../models'
import { ColorValue, DateTimeValue, ExpressionValue, NumericValue, StringValue } from '../types/collections'
import { inferValueFromString } from './valueCasting'

export interface CreateKeyValueInput {
  key: string
  value: string
  description?: string | undefined
  enabled?: boolean | undefined
}

function inferValueType(rawValue: string): StringValue | ColorValue | DateTimeValue | NumericValue | ExpressionValue {
  // If the raw value carries a Handlebars placeholder, treat the whole
  // thing as an expression — only ExpressionValues get resolved at
  // runtime, so anything expected to interpolate variables has to be
  // marked up front.
  if (rawValue.includes('{{')) {
    return new ExpressionValue(rawValue)
  }
  const cast = inferValueFromString(rawValue)
  switch (cast.kind) {
    case 'datetime':
      return new DateTimeValue(cast.date, cast.format)
    case 'numeric':
      return new NumericValue(cast.number, cast.format)
    case 'color':
      return new ColorValue(cast.color)
    default:
      return new StringValue(cast.value)
  }
}

/**
 * Build a KeyValue instance from raw strings, attempting to infer the most suitable Value type.
 *
 * Casting order:
 * - DateTimeValue (ISO-like strings)
 * - NumericValue
 * - ColorValue (hex HTML colors)
 * - StringValue (fallback)
 */
export function createTypedKeyValue(input: CreateKeyValueInput): KeyValue {
  return new KeyValue({
    key: input.key,
    value: inferValueType(input.value),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {})
  })
}

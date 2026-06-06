import type { ValueTypeKind } from '../../TypedValueField/castValue'

/**
 * Shared `excludeTypes` policies for scenario node operand fields, so the
 * type-pick menu only offers types that make sense for the operand. Leaving the
 * full menu on (e.g.) a date or a JSON-document operand ships nonsensical
 * choices like "a colour into a date".
 */

/** A text/document operand (json / xml / yaml / csv value, crypto / jwt / url
 * value): every kept type resolves to a string. Keeps `string`, `secret`,
 * `expression`, `variable`, `environment`. */
export const STRING_VALUE_EXCLUDE: ValueTypeKind[] = [
  'number', 'dateTime', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'null', 'list'
]

/** A date/time operand (datetime value / second date): keeps `dateTime`,
 * `string`, `secret`, `expression`, `variable`, `environment`. */
export const DATETIME_VALUE_EXCLUDE: ValueTypeKind[] = [
  'number', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'null', 'list'
]

/** A numeric operand (a count / amount / min / max): keeps `number`,
 * `variable`, `environment` — NOT `expression` (a Handlebars template isn't a
 * number). */
export const NUMERIC_VALUE_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'expression', 'dateTime', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'null', 'list'
]

import { ValueType } from './BaseValueType'

/**
 * Explicit null — a deliberate "no value", DISTINCT from the empty string and
 * from an ABSENT operand. Resolves to a real `null` at runtime; comparisons use
 * the null rules (null == null → true, anything-else == null → false, ordering
 * throws except `null <= null` / `null >= null`). Arithmetic / wait with a null
 * operand throws. Serialised as `{ type: 'null' }` (it carries no `value`).
 */
export class NullValue extends ValueType {
  readonly type = 'null' as const

  toString(): string {
    return ''
  }
}

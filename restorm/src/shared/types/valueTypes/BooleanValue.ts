import { ValueType } from './BaseValueType'

/**
 * Native boolean value. Rendered as a toggle in the variables table so
 * the user doesn't have to type `"true"` / `"false"` strings and risk
 * typos. Serialised as `{ type: 'boolean', value: true|false }`.
 */
export class BooleanValue extends ValueType {
  readonly type = 'boolean' as const
  value: boolean

  constructor(value: boolean) {
    super()
    this.value = value
  }

  toString(): string {
    return this.value ? 'true' : 'false'
  }
}

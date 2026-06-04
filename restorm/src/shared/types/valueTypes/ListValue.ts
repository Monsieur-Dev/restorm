import { ValueType } from './BaseValueType'

/**
 * An agnostic, UNTYPED list — an ordered collection of arbitrary typed values.
 * Each item is itself a `ValueType`, so a list can hold strings, numbers,
 * variables, environments… even other lists (nested editors). Resolves to a
 * real JS array at runtime: list ops (`aggregate` / `map` / `filter`) iterate
 * it, and comparisons use list semantics (`==` element-wise, `contains` =
 * subset). Serialised as `{ type: 'list', items: PersistedValue[] }`.
 */
export class ListValue extends ValueType {
  readonly type = 'list' as const
  items: ValueType[]

  constructor(items: ValueType[] = []) {
    super()
    this.items = items
  }

  /** A compact display string — each item's own `toString`, comma-joined. The
   * non-editable list field shows a truncated form of this. */
  toString(): string {
    return this.items.map((i) => i.toString()).join(', ')
  }
}

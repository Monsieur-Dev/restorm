import { ValueType } from './BaseValueType'

/**
 * A value picked from a user-defined custom value list (a named
 * label → value map living on the EnvironmentFolder). The user
 * selects a `label`; at dispatch the resolver looks the label up in
 * the list referenced by `listId` and substitutes the matching
 * `value` onto the wire. `toString()` returns the label for display
 * — the actual substitution happens in the value-resolution path,
 * which has access to the folder's `customValueLists`.
 */
export class CustomListValue extends ValueType {
  readonly type = 'customList' as const
  listId: string
  label: string

  constructor(listId: string, label: string) {
    super()
    this.listId = listId
    this.label = label
  }

  toString(): string {
    return this.label
  }
}

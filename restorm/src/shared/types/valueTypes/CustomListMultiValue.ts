import { ValueType } from './BaseValueType'

/**
 * Multi-select counterpart of {@link CustomListValue}. The user picks
 * several `labels` from one user-defined custom value list (referenced
 * by `listId`); at dispatch each label is resolved to its current entry
 * value, mirroring how `EnumListValue` repeats a query key per value.
 * `toString()` joins the labels for display — the substitution happens
 * in the value-resolution path, which has access to the folder's
 * `customValueLists`.
 */
export class CustomListMultiValue extends ValueType {
  readonly type = 'customListMulti' as const
  listId: string
  labels: string[]

  constructor(listId: string, labels: string[]) {
    super()
    this.listId = listId
    this.labels = labels
  }

  toString(): string {
    return this.labels.join(',')
  }
}

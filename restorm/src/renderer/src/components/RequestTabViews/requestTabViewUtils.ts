import type { KeyValue } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'

/** Update a reactive proxy property (intentional mutation for reactive objects) */
export function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

/** Convert plain history key-value entries to typed KeyValue objects */
export function toKeyValuesFromHistory(values: { key: string; value: string; enabled?: boolean }[]): KeyValue[] {
  return values.map((kv) => ({
    key: kv.key,
    value: new StringValue(kv.value),
    enabled: kv.enabled
  }))
}

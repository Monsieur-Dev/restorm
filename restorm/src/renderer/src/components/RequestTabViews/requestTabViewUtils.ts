import type React from 'react'
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

/**
 * Style for a short field label sitting on the same flex row as its input.
 *
 * `flexShrink: 0` + `whiteSpace: 'nowrap'` are load-bearing, not cosmetic: the
 * input beside the label is `flex: 1`, so without them the label shrinks to its
 * min-content width. Latin text breaks only between words and survives that,
 * but every CJK character is a break opportunity — the label then stacks one
 * glyph per line (`トピ / ッ / ク`).
 */
export const inlineFieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  flexShrink: 0,
  whiteSpace: 'nowrap'
}

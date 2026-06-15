import type { ValueType } from '../../../../shared/types/collections'

/**
 * Serialize a {@link ValueType} to its persisted shape so two values can be
 * compared for a "did the document content change?" decision.
 *
 * Relies on each ValueType's `toJSON` — notably `SecretValue.toJSON` strips its
 * non-serialised `resolved` plaintext — so a secret whose only edit is a param
 * change (e.g. `params.name`, which leaves `toString()` at the resolved/empty
 * value) still produces a DIFFERENT serialized shape. The key-value table uses
 * this to force a persist on any structural change, not just a type-kind change.
 */
export function serializeValueShape(value: ValueType): string {
  try {
    return JSON.stringify(value)
  } catch {
    return value.toString()
  }
}

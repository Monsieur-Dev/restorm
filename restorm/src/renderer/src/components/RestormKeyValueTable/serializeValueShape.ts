import type { ValueType } from '../../../../shared/types/collections'
import { SecretValue } from '../../../../shared/types/valueTypes/SecretValue'

/**
 * Serialize a {@link ValueType} to its persisted shape so two values can be
 * compared for a "did the document content change?" decision.
 *
 * Relies on each ValueType's `toJSON` — notably `SecretValue.toJSON` strips its
 * non-serialised `resolved` plaintext — so a secret whose only edit is a param
 * change (e.g. `params.name`, which leaves `toString()` at the resolved/empty
 * value) still produces a DIFFERENT serialized shape. The key-value table uses
 * this to force a persist on any structural change, not just a type-kind change.
 *
 * The secret's `resolved` plaintext is appended OUT OF BAND (it must stay out
 * of the persisted JSON): it is document content for the `.env` SIDECAR, so a
 * resolved-only edit — typing the secret's value in the retrieval modal —
 * must force the rebuild/persist path exactly like a structural change.
 * Without it the table sees "nothing changed", no document event fires, the
 * unit never goes dirty, and the autosave never writes the sidecar.
 */
export function serializeValueShape(value: ValueType): string {
  try {
    const base = JSON.stringify(value)
    const resolved = value instanceof SecretValue ? (value.resolved ?? '') : ''
    return resolved === '' ? base : `${base}#resolved=${resolved}`
  } catch {
    return value.toString()
  }
}

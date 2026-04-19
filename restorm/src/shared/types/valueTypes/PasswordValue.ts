import { NonSerialised } from 'electron-core-ui/decorators'
import { ValueType } from './BaseValueType'

export class PasswordValue extends ValueType {
  readonly type = 'password' as const

  /**
   * The plaintext secret is kept in memory for the life of the process
   * but is **never** written to disk as part of the document. The canonical
   * on-disk representation is `{ type: 'password' }` — the actual bytes
   * move through the sibling `restorm.env` file (for folder mode) or
   * `<file>.env` (for single-file mode), never through the JSON/YAML tree.
   *
   * Three layers enforce that invariant:
   *   1. `@NonSerialised` — decorator-aware filters (`filterNonSerialised`,
   *      the decomposer's `cleanse`) drop the property.
   *   2. `toJSON()` — any `JSON.stringify` path (draft store writes, IPC
   *      payloads, `structuredClone` fallbacks) emits the canonical shape
   *      even when the decorator system isn't in play.
   *   3. `serializeValueForPersistence()` in `valuePersistence.ts` already
   *      normalizes whole-tree saves before serialization.
   */
  @NonSerialised()
  value: string

  constructor(value: string) {
    super()
    this.value = value
  }

  toString(): string {
    return this.value
  }

  /**
   * Strip the plaintext on every `JSON.stringify`. The return shape
   * matches what `serializeValueForPersistence` produces and what
   * `KeyValue.fromPlain` expects on load.
   */
  toJSON(): { type: 'password' } {
    return { type: 'password' }
  }
}

import { NonSerialised } from 'electron-core-ui/decorators'
import { ValueType } from './BaseValueType'

export class SecretValue extends ValueType {
  readonly type = 'secret' as const
  source: string
  params: Record<string, unknown>

  /**
   * Resolved plaintext — populated by SecretHydrationService at run time and
   * kept only in memory. It MAY be resolved into the renderer and shown to the
   * user on demand (it is the user's own credential, and revealing it confirms
   * retrieval works); the invariant is that it is NEVER written to the persisted
   * `.restorm` document — only the `{ source, params }` lookup descriptor is.
   *
   * Three layers enforce that persistence invariant:
   *   1. `@NonSerialised` — decorator-aware filters drop the property.
   *   2. `toJSON()` — any `JSON.stringify` path emits the canonical shape
   *      even when the decorator system isn't in play.
   *   3. `serializeValueForPersistence()` in `valuePersistence.ts` normalizes
   *      whole-tree saves before serialization.
   */
  @NonSerialised()
  resolved?: string

  constructor(source: string, params: Record<string, unknown> = {}) {
    super()
    this.source = source
    this.params = params
  }

  toString(): string {
    return this.resolved ?? ''
  }

  /**
   * Strip the resolved plaintext on every `JSON.stringify`. The return shape
   * matches what `serializeValueForPersistence` produces and what
   * `KeyValue.fromPlain` expects on load.
   */
  toJSON(): { type: 'secret'; source: string; params: Record<string, unknown> } {
    return { type: 'secret', source: this.source, params: this.params }
  }
}

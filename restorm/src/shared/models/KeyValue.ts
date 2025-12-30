/**
 * KeyValue - A key-value pair used for headers, params, variables, etc.
 */

import {
  trackable,
  searchable,
  NonSerialised
} from 'electron-core-ui/main'
import type { RuntimeId } from './types'

/**
 * Key-value pair with optional description and enabled state.
 * Used for headers, query params, environment variables, etc.
 */
@trackable()
export class KeyValue {
  /** Runtime identifier (optional, generated at runtime) */
  @NonSerialised()
  id?: RuntimeId

  /** The key */
  @searchable.property({ weight: 1 })
  key = ''

  /** The value */
  @searchable.property({ weight: 0.5 })
  value = ''

  /** Optional description */
  description?: string

  /** Whether this key-value is enabled (default: true) */
  enabled = true

  constructor(init?: Partial<KeyValue>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create a KeyValue from a plain object
   */
  static fromPlain(obj: { id?: RuntimeId; key?: string; value?: string; description?: string; enabled?: boolean }): KeyValue {
    return new KeyValue({
      id: obj.id,
      key: obj.key ?? '',
      value: obj.value ?? '',
      description: obj.description,
      enabled: obj.enabled ?? true
    })
  }

  /**
   * Create a plain object from this KeyValue
   */
  toPlainObject(): Record<string, unknown> {
    return {
      key: this.key,
      value: this.value,
      description: this.description,
      enabled: this.enabled
    }
  }
}

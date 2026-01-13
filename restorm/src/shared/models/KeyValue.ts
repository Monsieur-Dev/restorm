/**
 * KeyValue - A key-value pair used for headers, params, variables, etc.
 */

import {
  trackable,
  searchable,
  NonSerialised,
  graphqlField
} from 'electron-core-ui/main'
import type { RuntimeId } from './types'
import type { ValueType } from '../types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue } from '../types/collections'

/**
 * Key-value pair with optional description and enabled state.
 * Used for headers, query params, environment variables, etc.
 */
@trackable()
export class KeyValue {
  /** Runtime identifier (optional, generated at runtime) */
  @graphqlField({ type: 'String', nullable: true })
  @NonSerialised()
  id?: RuntimeId

  /** The key */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1 })
  key = ''

  /** The value object implementing the Value abstract type */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 0.5 })
  value: ValueType = new StringValue('')

  /** Optional description */
  @graphqlField({ type: 'String', nullable: true })
  description?: string

  /** Whether this key-value is enabled (default: true) */
  @graphqlField({ type: 'Boolean', nullable: true })
  enabled = true

  constructor(init?: Partial<KeyValue>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create a KeyValue from a plain object
   */
  static fromPlain(obj: { id?: RuntimeId; key?: string; value?: string | ValueType; description?: string; enabled?: boolean }): KeyValue {
    let value: ValueType
    if (typeof obj.value === 'string') {
      // Backward compatibility: convert string to StringValue
      value = new StringValue(obj.value)
    } else if (obj.value instanceof StringValue || obj.value instanceof ColorValue || obj.value instanceof DateTimeValue || obj.value instanceof NumericValue || obj.value instanceof PasswordValue) {
      value = obj.value
    } else {
      value = new StringValue('')
    }

    return new KeyValue({
      id: obj.id,
      key: obj.key ?? '',
      value,
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
      value: this.value.toString(),
      description: this.description,
      enabled: this.enabled
    }
  }
}

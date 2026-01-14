/**
 * KeyValue - A key-value pair used for headers, params, variables, etc.
 */

import { trackable } from 'electron-core-ui/main'
import type { RuntimeId } from '../types'
import type { ValueType } from '../../types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue } from '../../types/collections'
import { BaseKeyValue } from './BaseKeyValue'

@trackable()
export class KeyValue extends BaseKeyValue {
  constructor(init?: Partial<KeyValue>) {
    super(init)
    // Ensure a default, without overwriting `init.value` (derived class field initializers run after `super()`).
    if (init?.value === undefined) {
      this.value = new StringValue('')
    }
  }

  static fromPlain(obj: { id?: RuntimeId; key?: string; value?: unknown; description?: string; enabled?: boolean }): KeyValue {
    let value: ValueType
    if (typeof obj.value === 'string') {
      value = new StringValue(obj.value)
    } else if (
      obj.value instanceof StringValue ||
      obj.value instanceof ColorValue ||
      obj.value instanceof DateTimeValue ||
      obj.value instanceof NumericValue ||
      obj.value instanceof PasswordValue
    ) {
      value = obj.value
    } else if (obj.value && typeof obj.value === 'object') {
      const plain = obj.value as { type?: unknown; value?: unknown; format?: unknown }
      const type = typeof plain.type === 'string' ? plain.type : ''

      switch (type) {
        case 'string':
          value = new StringValue(typeof plain.value === 'string' ? plain.value : '')
          break
        case 'color':
          value = new ColorValue(typeof plain.value === 'string' ? plain.value : '')
          break
        case 'numeric': {
          const num = typeof plain.value === 'number' ? plain.value : typeof plain.value === 'string' ? Number(plain.value) : NaN
          value = new NumericValue(Number.isFinite(num) ? num : 0, typeof plain.format === 'string' ? plain.format : 'decimal')
          break
        }
        case 'datetime': {
          const raw = plain.value
          const d =
            raw instanceof Date
              ? raw
              : typeof raw === 'string' || typeof raw === 'number'
                ? new Date(raw)
                : new Date()
          value = new DateTimeValue(d, typeof plain.format === 'string' ? plain.format : 'yyyy-MM-dd HH:mm:ss')
          break
        }
        case 'password':
          value = new PasswordValue(typeof plain.value === 'string' ? plain.value : '')
          break
        default:
          value = new StringValue('')
      }
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

  toPlainObject(): Record<string, unknown> {
    if (this.value instanceof PasswordValue) {
      return {
        key: this.key,
        value: { type: 'password' },
        description: this.description,
        enabled: this.enabled
      }
    }

    return {
      key: this.key,
      value: this.value.toString(),
      description: this.description,
      enabled: this.enabled
    }
  }
}

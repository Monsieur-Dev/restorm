/**
 * KeyValue - A key-value pair used for headers, params, variables, etc.
 */

import { trackable } from 'electron-core-ui/decorators'
import type { RuntimeId } from '../types'
import type { ValueType } from '../../types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue } from '../../types/collections'
import { SecretValue } from '../../types/valueTypes/SecretValue'
import { BaseKeyValue } from './BaseKeyValue'
import { serializeValueForPersistence } from '../../utils/valuePersistence'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

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
      obj.value instanceof SecretValue ||
      obj.value instanceof ExpressionValue ||
      obj.value instanceof BooleanValue ||
      obj.value instanceof EnumValue ||
      obj.value instanceof EnumListValue ||
      obj.value instanceof CustomListValue ||
      obj.value instanceof CustomListMultiValue
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
        case 'secret': {
          const p = plain as { source?: unknown; params?: unknown }
          value = new SecretValue(
            typeof p.source === 'string' ? p.source : '',
            isRecord(p.params) ? p.params : {}
          )
          break
        }
        case 'expression':
          value = new ExpressionValue(typeof plain.value === 'string' ? plain.value : '')
          break
        case 'boolean':
          value = new BooleanValue(plain.value === true || plain.value === 'true')
          break
        case 'enum': {
          const defId = (plain as { enumDefinitionId?: unknown }).enumDefinitionId
          value = new EnumValue(
            typeof plain.value === 'string' ? plain.value : '',
            typeof defId === 'string' ? defId : ''
          )
          break
        }
        case 'enumList': {
          const raw = plain.value
          const defId = (plain as { enumDefinitionId?: unknown }).enumDefinitionId
          value = new EnumListValue(
            Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [],
            typeof defId === 'string' ? defId : ''
          )
          break
        }
        case 'customList': {
          const p = plain as { listId?: unknown; label?: unknown }
          value = new CustomListValue(
            typeof p.listId === 'string' ? p.listId : '',
            typeof p.label === 'string' ? p.label : ''
          )
          break
        }
        case 'customListMulti': {
          const p = plain as { listId?: unknown; labels?: unknown }
          value = new CustomListMultiValue(
            typeof p.listId === 'string' ? p.listId : '',
            Array.isArray(p.labels) ? p.labels.filter((v): v is string => typeof v === 'string') : []
          )
          break
        }
        default:
          value = new StringValue('')
      }
    } else {
      value = new StringValue('')
    }

    return new KeyValue({
      ...(obj.id !== undefined && { id: obj.id }),
      key: obj.key ?? '',
      value,
      ...(obj.description !== undefined && { description: obj.description }),
      enabled: obj.enabled ?? true
    })
  }

  toPlainObject(): Record<string, unknown> {
    return {
      key: this.key,
      value: serializeValueForPersistence(this.value),
      description: this.description,
      enabled: this.enabled
    }
  }
}

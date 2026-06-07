import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue, VariableValue, EnvironmentValue, NullValue, ListValue, type ValueType } from '../../../shared/types/collections'

export function normalizeValueType(input: unknown): ValueType {
  if (
    input instanceof StringValue ||
    input instanceof ColorValue ||
    input instanceof DateTimeValue ||
    input instanceof NumericValue ||
    input instanceof PasswordValue ||
    input instanceof ExpressionValue ||
    input instanceof BooleanValue ||
    input instanceof EnumValue ||
    input instanceof EnumListValue ||
    input instanceof CustomListValue ||
    input instanceof CustomListMultiValue ||
    input instanceof VariableValue ||
    input instanceof EnvironmentValue ||
    input instanceof NullValue ||
    input instanceof ListValue
  ) {
    return input
  }

  if (typeof input === 'string') {
    return new StringValue(input)
  }

  // Bare primitives (legacy config stored a raw number/boolean before the field
  // used a typed value) — wrap them so the value isn't lost to the empty-string
  // fallback below.
  if (typeof input === 'number') {
    return new NumericValue(input, 'decimal')
  }
  if (typeof input === 'boolean') {
    return new BooleanValue(input)
  }

  if (input && typeof input === 'object') {
    const plain = input as { type?: unknown; value?: unknown; format?: unknown }
    const type = typeof plain.type === 'string' ? plain.type : ''

    switch (type) {
      case 'string':
        return new StringValue(typeof plain.value === 'string' ? plain.value : '')
      case 'color':
        return new ColorValue(typeof plain.value === 'string' ? plain.value : '')
      case 'numeric': {
        const num = typeof plain.value === 'number' ? plain.value : typeof plain.value === 'string' ? Number(plain.value) : NaN
        return new NumericValue(Number.isFinite(num) ? num : 0, typeof plain.format === 'string' ? plain.format : 'decimal')
      }
      case 'datetime': {
        const raw = plain.value
        const d =
          raw instanceof Date
            ? raw
            : typeof raw === 'string' || typeof raw === 'number'
              ? new Date(raw)
              : new Date()
        return new DateTimeValue(d, typeof plain.format === 'string' ? plain.format : 'yyyy-MM-dd HH:mm:ss')
      }
      case 'password':
        return new PasswordValue(typeof plain.value === 'string' ? plain.value : '')
      case 'expression':
        return new ExpressionValue(typeof plain.value === 'string' ? plain.value : '')
      case 'variable':
        return new VariableValue(typeof plain.value === 'string' ? plain.value : '')
      case 'environment':
        return new EnvironmentValue(typeof plain.value === 'string' ? plain.value : '')
      case 'null':
        return new NullValue()
      case 'list': {
        // Recurse: each item is itself a persisted typed value (lists nest).
        const items = (plain as { items?: unknown }).items
        return new ListValue(Array.isArray(items) ? items.map(normalizeValueType) : [])
      }
      case 'boolean':
        return new BooleanValue(plain.value === true || plain.value === 'true')
      case 'enum': {
        const defId = (plain as { enumDefinitionId?: unknown }).enumDefinitionId
        return new EnumValue(
          typeof plain.value === 'string' ? plain.value : '',
          typeof defId === 'string' ? defId : ''
        )
      }
      case 'enumList': {
        const raw = plain.value
        const defId = (plain as { enumDefinitionId?: unknown }).enumDefinitionId
        return new EnumListValue(
          Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [],
          typeof defId === 'string' ? defId : ''
        )
      }
      case 'customList': {
        const p = plain as { listId?: unknown; label?: unknown }
        return new CustomListValue(
          typeof p.listId === 'string' ? p.listId : '',
          typeof p.label === 'string' ? p.label : ''
        )
      }
      case 'customListMulti': {
        const p = plain as { listId?: unknown; labels?: unknown }
        return new CustomListMultiValue(
          typeof p.listId === 'string' ? p.listId : '',
          Array.isArray(p.labels) ? p.labels.filter((v): v is string => typeof v === 'string') : []
        )
      }
      default:
        return new StringValue('')
    }
  }

  return new StringValue('')
}

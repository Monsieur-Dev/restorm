import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue, type ValueType } from '../types/collections'

export function normalizeValueType(input: unknown): ValueType {
  if (
    input instanceof StringValue ||
    input instanceof ColorValue ||
    input instanceof DateTimeValue ||
    input instanceof NumericValue ||
    input instanceof PasswordValue
  ) {
    return input
  }

  if (typeof input === 'string') {
    return new StringValue(input)
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
      default:
        return new StringValue('')
    }
  }

  return new StringValue('')
}

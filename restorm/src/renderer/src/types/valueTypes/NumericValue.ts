import { ValueType } from './BaseValueType'

export class NumericValue extends ValueType {
  readonly type = 'numeric' as const
  value: number
  format: string

  constructor(value: number, format: string) {
    super()
    this.value = value
    this.format = format
  }

  toString(): string {
    const num = this.value
    const format = this.format

    if (format === 'decimal' || format === '') {
      return num.toString()
    }
    if (format === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
    }
    if (format === 'percentage') {
      return `${(num * 100).toFixed(2)}%`
    }
    if (format.startsWith('decimal:')) {
      const decimals = parseInt(format.split(':')[1] ?? '2', 10)
      return num.toFixed(decimals)
    }

    return num.toString()
  }
}

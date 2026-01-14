import { ValueType } from './BaseValueType'
import { DateTime } from 'luxon'

export class DateTimeValue extends ValueType {
  readonly type = 'datetime' as const
  value: Date
  format: string

  constructor(value: Date, format: string) {
    super()
    this.value = value
    this.format = format
  }

  toString(): string {
    const value = this.value
    const format = this.format

    if (format === 'unix') {
      return String(Math.floor(value.getTime() / 1000))
    }
    if (format === 'epoch') {
      return String(value.getTime())
    }
    if (format === 'iso') {
      return DateTime.fromJSDate(value).toISO() ?? ''
    }
    if (format === '') {
      return DateTime.fromJSDate(value).toISO() ?? ''
    }

    return DateTime.fromJSDate(value).toFormat(format)
  }
}

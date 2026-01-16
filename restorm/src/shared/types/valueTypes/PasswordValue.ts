import { ValueType } from './BaseValueType'

export class PasswordValue extends ValueType {
  readonly type = 'password' as const
  value: string

  constructor(value: string) {
    super()
    this.value = value
  }

  toString(): string {
    return this.value
  }
}

import { NonSerialised } from 'electron-core-ui/main'
import { ValueType } from './BaseValueType'

export class PasswordValue extends ValueType {
  readonly type = 'password' as const
  @NonSerialised()
  value: string

  constructor(value: string) {
    super()
    this.value = value
  }

  toString(): string {
    return this.value
  }
}

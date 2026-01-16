import { StringBackedValue } from './BaseValueType'

export class StringValue extends StringBackedValue {
  readonly type = 'string' as const
}

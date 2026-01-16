import { StringBackedValue } from './BaseValueType'

export class ColorValue extends StringBackedValue {
  readonly type = 'color' as const
}

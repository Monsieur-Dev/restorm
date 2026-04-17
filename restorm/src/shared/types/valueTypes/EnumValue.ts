import { ValueType } from './BaseValueType'

/**
 * Single-select value from a closed enum list.
 * References an EnumDefinition by id for the allowed values.
 */
export class EnumValue extends ValueType {
  readonly type = 'enum' as const
  value: string
  enumDefinitionId: string

  constructor(value: string, enumDefinitionId: string) {
    super()
    this.value = value
    this.enumDefinitionId = enumDefinitionId
  }

  toString(): string {
    return this.value
  }
}

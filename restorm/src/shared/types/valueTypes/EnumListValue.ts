import { ValueType } from './BaseValueType'

/**
 * Multi-select value from a closed enum list.
 * References an EnumDefinition by id for the allowed values.
 */
export class EnumListValue extends ValueType {
  readonly type = 'enumList' as const
  value: string[]
  enumDefinitionId: string

  constructor(value: string[], enumDefinitionId: string) {
    super()
    this.value = value
    this.enumDefinitionId = enumDefinitionId
  }

  toString(): string {
    return this.value.join(',')
  }
}

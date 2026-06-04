export type ValueTypeName = 'string' | 'color' | 'datetime' | 'numeric' | 'password' | 'expression' | 'boolean' | 'enum' | 'enumList' | 'customList' | 'customListMulti' | 'variable' | 'environment' | 'null'

/**
 * Abstract base class for all value objects.
 * This type cannot be instantiated directly.
 */
export abstract class ValueType {
  abstract readonly type: ValueTypeName
  abstract toString(): string
}

/**
 * Base class for values that store a string.
 */
export abstract class StringBackedValue extends ValueType {
  value: string

  constructor(value: string) {
    super()
    this.value = value
  }

  toString(): string {
    return this.value
  }
}

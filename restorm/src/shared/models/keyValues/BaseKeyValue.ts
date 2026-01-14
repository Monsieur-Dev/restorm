import { searchable, NonSerialised, graphqlField } from 'electron-core-ui/main'
import type { RuntimeId } from '../types'
import type { ValueType } from '../../types/collections'

export abstract class BaseKeyValue {
  @graphqlField({ type: 'String', nullable: true })
  @NonSerialised()
  id?: RuntimeId

  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1 })
  key = ''

  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 0.5 })
  value!: ValueType

  @graphqlField({ type: 'String', nullable: true })
  description?: string

  @graphqlField({ type: 'Boolean', nullable: true })
  enabled = true

  constructor(init?: Partial<BaseKeyValue>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  abstract toPlainObject(): Record<string, unknown>
}

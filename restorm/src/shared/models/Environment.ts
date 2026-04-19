/**
 * Environment - Environment configuration with variables
 */

import {
  trackable,
  searchable,
  fileNaming,
  graphqlField
} from 'electron-core-ui/decorators'
import { KeyValue } from './KeyValue'
import type { RuntimeId, Icon } from './types'

/**
 * Environment configuration with variables and optional sub-environments.
 * In folder mode, each environment is saved as a separate file.
 */
@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class Environment {
  /** Stable identifier persisted with the document. See `Folder.id`. */
  @graphqlField({ type: 'String' })
  id!: RuntimeId

  /** Display name of the environment */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the environment */
  icon?: Icon

  /** Optional custom color (hex string, e.g. "#ff6600") */
  color?: string

  /**
   * Key-value pairs for this environment. Kept inline with the
   * environment document (no `@separateFiles`) so an env save is
   * atomic: `Environment` is the save unit, not each KeyValue.
   */
  @graphqlField({ type: 'KeyValue', isArray: true })
  variables: KeyValue[] = []

  /** Optional nested sub-environments */
  @graphqlField({ type: 'Environment', isArray: true, nullable: true })
  subEnvironments?: Environment[]

  constructor(init?: Partial<Environment>) {
    if (init) {
      Object.assign(this, init)
      // Convert plain variables to KeyValue instances
      if (init.variables) {
        this.variables = init.variables.map(v =>
          v instanceof KeyValue ? v : KeyValue.fromPlain(v as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
      // Convert plain sub-environments to Environment instances
      if (init.subEnvironments) {
        this.subEnvironments = init.subEnvironments.map(e =>
          e instanceof Environment ? e : Environment.fromPlain(e as unknown as Parameters<typeof Environment.fromPlain>[0])
        )
      }
    }
  }

  /**
   * Create an Environment from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    color?: string
    variables?: Parameters<typeof KeyValue.fromPlain>[0][]
    subEnvironments?: Parameters<typeof Environment.fromPlain>[0][]
  }): Environment {
    const env = new Environment({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      ...(obj.color !== undefined && { color: obj.color })
    })
    if (Array.isArray(obj.variables)) {
      env.variables = obj.variables.map(v => KeyValue.fromPlain(v))
    }
    if (Array.isArray(obj.subEnvironments)) {
      env.subEnvironments = obj.subEnvironments.map(e => Environment.fromPlain(e))
    }
    return env
  }

  /**
   * Create a plain object from this Environment
   */
  toPlainObject(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      color: this.color,
      variables: this.variables.map(v => v.toPlainObject()),
      subEnvironments: this.subEnvironments?.map(e => e.toPlainObject())
    }
  }
}

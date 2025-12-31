/**
 * Environment - Environment configuration with variables
 */

import {
  trackable,
  searchable,
  NonSerialised,
  separateFiles,
  fileNaming
} from 'electron-core-ui/main'
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
  /** Runtime identifier (generated at runtime, not persisted) */
  @NonSerialised()
  id!: RuntimeId

  /** Display name of the environment */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the environment */
  icon?: Icon

  /** Key-value pairs for this environment */
  @separateFiles()
  variables: KeyValue[] = []

  /** Optional nested sub-environments */
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
    variables?: Parameters<typeof KeyValue.fromPlain>[0][]
    subEnvironments?: Parameters<typeof Environment.fromPlain>[0][]
  }): Environment {
    const env = new Environment({
      id: obj.id,
      name: obj.name ?? '',
      icon: obj.icon
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
      name: this.name,
      icon: this.icon,
      variables: this.variables.map(v => v.toPlainObject()),
      subEnvironments: this.subEnvironments?.map(e => e.toPlainObject())
    }
  }
}

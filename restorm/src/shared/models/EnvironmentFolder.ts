/**
 * EnvironmentFolder - A folder that also contains environment configurations
 */

import {
  trackable,
  searchable,
  NonSerialised,
  separateFolders,
  fileNaming
} from 'electron-core-ui/main'
import { Environment } from './Environment'
import type { RuntimeId, Icon, FolderConfiguration, FolderType, BaseFolderItem } from './types'

/**
 * Environment folder containing both items and environment configurations.
 * This is typically the root folder of a collection.
 * In folder mode, environments are saved in their own subdirectory.
 */
@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class EnvironmentFolder {
  /** Runtime identifier (generated at runtime, not persisted) */
  @NonSerialised()
  id!: RuntimeId

  /** Display name of the folder */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the folder */
  icon?: Icon

  /** Documentation describing the folder contents */
  @searchable.property({ weight: 1 })
  documentation = ''

  /** Optional user notes */
  @searchable.property({ weight: 0.5 })
  notes?: string

  /** Tags for categorization and filtering */
  @searchable.property({ weight: 1.5, filterable: true })
  tags: string[] = []

  /** Discriminator to identify environment folders */
  folderType: FolderType = 'environment'

  /** Folder configuration */
  configuration: FolderConfiguration = {}

  /** Environment configurations for this folder */
  @separateFolders()
  environments: Environment[] = []

  /** Folder contents: requests and sub-folders */
  @separateFolders()
  items: BaseFolderItem[] = []

  constructor(init?: Partial<EnvironmentFolder>) {
    if (init) {
      Object.assign(this, init)
      // Convert plain environments to Environment instances
      if (init.environments) {
        this.environments = init.environments.map(e =>
          e instanceof Environment ? e : Environment.fromPlain(e as unknown as Parameters<typeof Environment.fromPlain>[0])
        )
      }
    }
  }

  /**
   * Create an EnvironmentFolder from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    folderType?: FolderType
    configuration?: FolderConfiguration
    environments?: Parameters<typeof Environment.fromPlain>[0][]
    items?: BaseFolderItem[]
  }): EnvironmentFolder {
    const folder = new EnvironmentFolder({
      id: obj.id,
      name: obj.name ?? '',
      icon: obj.icon,
      documentation: obj.documentation ?? '',
      notes: obj.notes,
      tags: obj.tags ?? [],
      folderType: 'environment',
      configuration: obj.configuration ?? {}
    })
    if (Array.isArray(obj.environments)) {
      folder.environments = obj.environments.map(e => Environment.fromPlain(e))
    }
    if (Array.isArray(obj.items)) {
      // Items will be converted by the caller with proper type knowledge
      folder.items = obj.items
    }
    return folder
  }

  /**
   * Create a plain object from this EnvironmentFolder
   */
  toPlainObject(): Record<string, unknown> {
    return {
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      folderType: this.folderType,
      configuration: this.configuration,
      environments: this.environments.map(e => e.toPlainObject()),
      items: this.items.map(item => item.toPlainObject())
    }
  }
}

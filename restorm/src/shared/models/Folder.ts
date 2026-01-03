/**
 * Folder - A folder containing requests and sub-folders
 */

import {
  trackable,
  searchable,
  NonSerialised,
  separateFolders,
  fileNaming,
  graphqlField
} from 'electron-core-ui/main'
import type { RuntimeId, Icon, FolderConfiguration, BaseFolderItem } from './types'

/**
 * Folder containing requests and sub-folders.
 * In folder mode, each folder becomes a physical directory.
 */
@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class Folder {
  /** Runtime identifier (generated at runtime, not persisted) */
  @graphqlField({ type: 'String' })
  @NonSerialised()
  id!: RuntimeId

  /** Display name of the folder */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the folder */
  icon?: Icon

  /** Documentation describing the folder contents */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 1 })
  documentation = ''

  /** Optional user notes */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 0.5 })
  notes?: string

  /** Tags for categorization and filtering */
  @graphqlField({ type: 'String', isArray: true })
  @searchable.property({ weight: 1.5, filterable: true })
  tags: string[] = []

  /** Folder configuration */
  @graphqlField({ type: 'JSON', nullable: true })
  configuration: FolderConfiguration = {}

  /** Folder contents: requests and sub-folders */
  @graphqlField({ type: 'FolderItem', isArray: true })
  @separateFolders()
  items: BaseFolderItem[] = []

  constructor(init?: Partial<Folder>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create a plain object from this Folder
   */
  toPlainObject(): Record<string, unknown> {
    return {
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      configuration: this.configuration,
      items: this.items.map(item => item.toPlainObject())
    }
  }
}

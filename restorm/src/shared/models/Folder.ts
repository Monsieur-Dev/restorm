/**
 * Folder - A folder containing requests and sub-folders
 */

import {
  trackable,
  searchable,
  NonSerialised,
  separateFolders,
  fileNaming
} from 'electron-core-ui/main'
import type { RuntimeId, Icon, FolderConfiguration, BaseFolderItem } from './types'

/**
 * Folder containing requests and sub-folders.
 * In folder mode, each folder becomes a physical directory.
 */
@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name' })
export class Folder {
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

  /** Folder configuration */
  configuration: FolderConfiguration = {}

  /** Folder contents: requests and sub-folders */
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

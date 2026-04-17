/**
 * EnvironmentFolder - A folder that also contains environment configurations
 */

import {
  trackable,
  searchable,
  separateFolders,
  fileNaming,
  graphqlField
} from 'electron-core-ui/main'
import { Environment } from './Environment'
import type { RuntimeId, Icon, FolderConfiguration, FolderType, BaseFolderItem } from './types'
import type { ApiDocumentation } from '../types/apiDocumentation'

/**
 * Environment folder containing both items and environment configurations.
 * This is typically the root folder of a collection.
 * In folder mode, environments are saved in their own subdirectory.
 */
@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class EnvironmentFolder {
  /** Stable identifier persisted with the document so workbench layout,
   * per-request env selection, and other settings can reference it across
   * app executions. Generated on first save or first load of a legacy
   * file that lacks one. */
  @graphqlField({ type: 'String' })
  id!: RuntimeId

  /** Display name of the folder */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the folder */
  icon?: Icon

  /** Discriminator to identify environment folders */
  @graphqlField({ type: 'String' })
  folderType: FolderType = 'environment'

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

  /** Map of tag text to hex color (e.g. { "query": "#ff0000" }) */
  tagColors: Record<string, string> = {}

  /** Folder configuration */
  configuration: FolderConfiguration = {}

  /** Environment configurations for this folder */
  @graphqlField({ type: 'Environment', isArray: true })
  @separateFolders()
  environments: Environment[] = []

  /** Folder contents: requests and sub-folders */
  @graphqlField({ type: 'FolderItem', isArray: true })
  @separateFolders()
  items: BaseFolderItem[] = []

  /**
   * Structured API documentation (imported specs only). Compiled markdown for
   * individual routes is derived from this on the fly — never persisted on routes.
   */
  apiDocumentation?: ApiDocumentation

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
    tagColors?: Record<string, string>
    folderType?: FolderType
    configuration?: FolderConfiguration
    environments?: Parameters<typeof Environment.fromPlain>[0][]
    items?: BaseFolderItem[]
    apiDocumentation?: ApiDocumentation
  }): EnvironmentFolder {
    const folder = new EnvironmentFolder({
      id: obj.id,
      name: obj.name ?? '',
      icon: obj.icon,
      documentation: obj.documentation ?? '',
      notes: obj.notes,
      tags: obj.tags ?? [],
      tagColors: obj.tagColors ?? {},
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
    if (obj.apiDocumentation) {
      folder.apiDocumentation = obj.apiDocumentation
    }
    return folder
  }

  /**
   * Create a plain object from this EnvironmentFolder
   */
  toPlainObject(): Record<string, unknown> {
    const plain: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      tagColors: this.tagColors,
      folderType: this.folderType,
      configuration: this.configuration,
      environments: this.environments.map(e => e.toPlainObject()),
      items: this.items.map(item => item.toPlainObject())
    }
    if (this.apiDocumentation) plain.apiDocumentation = this.apiDocumentation
    return plain
  }
}

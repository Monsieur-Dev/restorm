/**
 * EnvironmentFolder - A folder that also contains environment configurations
 */

import {
  trackable,
  searchable,
  separateFolders,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { Environment } from './Environment'
import type { RuntimeId, Icon, FolderConfiguration, FolderType, BaseFolderItem } from './types'
import type { ApiDocumentation } from '../types/apiDocumentation'
import type { ApiUpdateConfig, ImportSourceType, CustomValueList } from '../types/baseTypes'

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

  /** Optional user notes */
  @graphqlField({ type: 'String', nullable: true })
  @searchable.property({ weight: 0.5 })
  @TreatEmptyAsUndefined()
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

  /** How this folder was created (swagger, graphql, …). Drives the
   * "Refresh from source" flow and the home-page logo. */
  importSource?: ImportSourceType

  /** Per-folder periodic spec re-check + idempotent refresh
   * configuration. Backfilled on load from the legacy
   * `apiDocumentation.sourceUrl` when absent. */
  apiUpdate?: ApiUpdateConfig

  /** User-defined custom value lists (named label → value maps). Fully
   * user-managed; never touched by re-import. Preserved through the
   * renderer→main `collections:sync` mirror so the dispatch resolver in
   * the main process can read it to substitute label → value. */
  customValueLists?: CustomValueList[]

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
    notes?: string
    tags?: string[]
    tagColors?: Record<string, string>
    folderType?: FolderType
    configuration?: FolderConfiguration
    environments?: Parameters<typeof Environment.fromPlain>[0][]
    items?: BaseFolderItem[]
    apiDocumentation?: ApiDocumentation
    importSource?: ImportSourceType
    apiUpdate?: ApiUpdateConfig
    customValueLists?: CustomValueList[]
  }): EnvironmentFolder {
    const folder = new EnvironmentFolder({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      ...(obj.notes !== undefined && { notes: obj.notes }),
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
    if (obj.importSource) folder.importSource = obj.importSource
    if (obj.apiUpdate) folder.apiUpdate = obj.apiUpdate
    if (Array.isArray(obj.customValueLists)) folder.customValueLists = obj.customValueLists
    return folder
  }

  /**
   * Create a plain object from this EnvironmentFolder
   */
  toPlainObject(): Record<string, unknown> {
    // No `fileFormatVersion` here: the format version describes the
    // FILE, not a collection inside it, and lives at the document root.
    // See `src/shared/config/fileFormatVersion.ts`.
    const plain: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      icon: this.icon,
      folderType: this.folderType,
      notes: this.notes,
      tags: this.tags,
      tagColors: this.tagColors,
      configuration: this.configuration,
      environments: this.environments.map(e => e.toPlainObject()),
      items: this.items.map(item => item.toPlainObject())
    }
    if (this.apiDocumentation) plain['apiDocumentation'] = this.apiDocumentation
    if (this.importSource) plain['importSource'] = this.importSource
    if (this.apiUpdate) plain['apiUpdate'] = this.apiUpdate
    if (this.customValueLists) plain['customValueLists'] = this.customValueLists
    return plain
  }
}

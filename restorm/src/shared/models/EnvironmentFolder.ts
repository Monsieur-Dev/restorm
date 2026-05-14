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
import type { ApiUpdateConfig, ImportSourceType } from '../types/baseTypes'
import { CURRENT_FILE_FORMAT_VERSION } from '../config/fileFormatVersion'

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

  /**
   * On-disk file-format version stamped on the root env folder. Lets a
   * future breaking model change migrate forward from the right starting
   * point. New folders get `CURRENT_FILE_FORMAT_VERSION`; legacy files
   * are defaulted on load via `normalizeFileFormatVersion`.
   */
  fileFormatVersion: number = CURRENT_FILE_FORMAT_VERSION

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
    fileFormatVersion?: number
    configuration?: FolderConfiguration
    environments?: Parameters<typeof Environment.fromPlain>[0][]
    items?: BaseFolderItem[]
    apiDocumentation?: ApiDocumentation
    importSource?: ImportSourceType
    apiUpdate?: ApiUpdateConfig
  }): EnvironmentFolder {
    const folder = new EnvironmentFolder({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      tagColors: obj.tagColors ?? {},
      folderType: 'environment',
      // Legacy files predating the version field omit it — default on
      // load. `normalizeFileFormatVersion` handles the same case for
      // plain objects that never reach this factory (e.g. the
      // renderer's `processAfterDeserialization` → `makeReactiveFolder`
      // path).
      fileFormatVersion:
        typeof obj.fileFormatVersion === 'number' && Number.isFinite(obj.fileFormatVersion)
          ? obj.fileFormatVersion
          : CURRENT_FILE_FORMAT_VERSION,
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
    return folder
  }

  /**
   * Create a plain object from this EnvironmentFolder
   */
  toPlainObject(): Record<string, unknown> {
    // Place `fileFormatVersion` right after `folderType` so it lands near
    // the top of the serialized YAML/JSON5 output — the persistence
    // service preserves property order for those formats, and a visible
    // version stamp at the top of the file is easier to inspect.
    const plain: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      icon: this.icon,
      folderType: this.folderType,
      fileFormatVersion: this.fileFormatVersion,
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
    return plain
  }
}

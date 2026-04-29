import type { RuntimeId, Icon, Environment, FolderConfiguration, EnumDefinition, ImportSourceType, ApiUpdateConfig } from './baseTypes'
import type { Request } from './requests/index'

export interface Folder {
  id: RuntimeId
  name: string
  icon?: Icon
  documentation: string
  notes?: string
  tags: string[]
  configuration: FolderConfiguration
  items: FolderItem[]
}

export interface EnvironmentFolder extends Folder {
  folderType: 'environment'
  /**
   * On-disk file-format version, present on the root env folder only.
   * See `restorm/src/shared/config/fileFormatVersion.ts` for the current
   * value and load-time defaulting rules. Currently `1`.
   */
  fileFormatVersion: number
  environments: Environment[]
  tagColors?: Record<string, string>
  enumDefinitions?: EnumDefinition[]
  /** How this folder was created (swagger, grpc, graphql, etc.). Absent for manually created folders. */
  importSource?: ImportSourceType
  /**
   * Configuration for the periodic spec re-check + idempotent
   * refresh. Absent for manually created folders, and also absent on
   * legacy folders saved before the field existed — the load-time
   * migration backfills it from `apiDocumentation.sourceUrl` when
   * possible.
   */
  apiUpdate?: ApiUpdateConfig
}

export type FolderItem = Folder | EnvironmentFolder | Request

export function isEnvironmentFolder(item: FolderItem): item is EnvironmentFolder {
  // Some legacy/loaded objects may omit `configuration` at runtime; detection should rely on `folderType`.
  if (!('items' in item) || !('folderType' in item)) {
    return false
  }
  return (item as { folderType: string }).folderType === 'environment'
}

export function isFolder(item: FolderItem): item is Folder {
  return 'items' in item && 'configuration' in item && !isEnvironmentFolder(item)
}

export function isAnyFolder(item: FolderItem): item is Folder | EnvironmentFolder {
  return 'items' in item && 'configuration' in item
}

export function isRequest(item: FolderItem): item is Request {
  return 'type' in item && !('items' in item)
}

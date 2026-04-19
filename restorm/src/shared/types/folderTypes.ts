import type { RuntimeId, Icon, Environment, FolderConfiguration, EnumDefinition, ImportSourceType } from './baseTypes'
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
   * value and load-time defaulting rules. `1` from OYO-200 onward.
   */
  fileFormatVersion: number
  environments: Environment[]
  tagColors?: Record<string, string>
  enumDefinitions?: EnumDefinition[]
  /** How this folder was created (swagger, grpc, graphql, etc.). Absent for manually created folders. */
  importSource?: ImportSourceType
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

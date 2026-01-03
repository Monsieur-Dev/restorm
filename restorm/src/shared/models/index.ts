/**
 * Restorm Models - Decorated classes for persistence and GraphQL
 *
 * These classes use decorators from electron-core-ui to define:
 * - Serialization behavior (@NonSerialised)
 * - Search indexing (@searchable)
 * - Change tracking (@trackable)
 * - File structure (@separateFiles, @separateFolders, @fileNaming)
 */

export * from './BaseDocument'
export * from './KeyValue'
export * from './Environment'
export * from './Folder'
export * from './EnvironmentFolder'
export * from './requests'
export * from './types'

// Re-export union types for convenience
import { Folder } from './Folder'
import { EnvironmentFolder } from './EnvironmentFolder'
import type { Request } from './requests'
import type { BaseFolderItem } from './types'

/** Union type for folder items */
export type FolderItem = Folder | EnvironmentFolder | Request

/** Type guard: check if item is an EnvironmentFolder */
export function isEnvironmentFolder(item: BaseFolderItem | FolderItem): item is EnvironmentFolder {
  return item instanceof EnvironmentFolder || (
    'folderType' in item && (item as EnvironmentFolder).folderType === 'environment'
  )
}

/** Type guard: check if item is a Folder (but not an EnvironmentFolder) */
export function isFolder(item: BaseFolderItem | FolderItem): item is Folder {
  return (item instanceof Folder || 'items' in item) && !isEnvironmentFolder(item)
}

/** Type guard: check if item is any kind of folder */
export function isAnyFolder(item: BaseFolderItem | FolderItem): item is Folder | EnvironmentFolder {
  return isFolder(item) || isEnvironmentFolder(item)
}

/** Type guard: check if item is a Request */
export function isRequest(item: BaseFolderItem | FolderItem): item is Request {
  return 'type' in item && !('items' in item)
}

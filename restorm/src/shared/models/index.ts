/**
 * Restorm Models - Decorated classes for persistence and GraphQL
 *
 * These classes use decorators from electron-core-ui to define:
 * - Serialization behavior (@NonSerialised)
 * - Search indexing (@searchable)
 * - Change tracking (@trackable)
 * - Save units (@saveUnits, @fileNaming)
 */

export * from './BaseDocument'
export * from './KeyValue'
export * from './Environment'
export * from './Folder'
export * from './EnvironmentFolder'
export * from './Scenario'
export * from './ApiDesign'
export * from './requests'
export * from './types'

// Re-export union types for convenience
import { Folder } from './Folder'
import { EnvironmentFolder } from './EnvironmentFolder'
import { Scenario } from './Scenario'
import { ApiDesign } from './ApiDesign'
import type { Request } from './requests'
import type { BaseFolderItem } from './types'

/** Union type for folder items */
export type FolderItem = Folder | EnvironmentFolder | Request | Scenario | ApiDesign

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

/** Type guard: check if item is a Scenario */
export function isScenario(item: BaseFolderItem | FolderItem): item is Scenario {
  return item instanceof Scenario || (
    'type' in item && (item as { type: unknown }).type === 'scenario'
  )
}

/** Type guard: check if item is an ApiDesign */
export function isApiDesign(item: BaseFolderItem | FolderItem): item is ApiDesign {
  return item instanceof ApiDesign || (
    'type' in item && (item as { type: unknown }).type === 'design'
  )
}

/** Type guard: check if item is a Request */
export function isRequest(item: BaseFolderItem | FolderItem): item is Request {
  // A Scenario and an ApiDesign also carry `type` + no `items`; exclude them.
  return 'type' in item && !('items' in item) && !isScenario(item) && !isApiDesign(item)
}

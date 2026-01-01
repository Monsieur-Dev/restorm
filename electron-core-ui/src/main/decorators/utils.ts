/**
 * Utility Functions for Decorators
 */

import { TrackableConfig, getTrackableConfig, getTrackableProperties } from './trackable'
import { SearchableConfig, getSearchableConfig, getSearchableProperties } from './searchable'
import { getNonSerialisedProperties } from './nonSerialised'
import { SeparateFilesConfig, getSeparateFilesProperties } from './separateFiles'
import { SeparateFoldersConfig, getSeparateFoldersProperties } from './separateFolders'
import { FileNamingConfig, getFileNamingConfig } from './fileNaming'

/** All decorator metadata for a class */
export interface AllMetadata {
  trackable: TrackableConfig | undefined
  searchable: SearchableConfig | undefined
  fileNaming: FileNamingConfig | undefined
  trackableProperties: Map<string | symbol, TrackableConfig>
  searchableProperties: Map<string | symbol, SearchableConfig>
  nonSerialisedProperties: Set<string | symbol>
  separateFilesProperties: Map<string | symbol, SeparateFilesConfig>
  separateFoldersProperties: Map<string | symbol, SeparateFoldersConfig>
}

/**
 * Get all decorator metadata for a class
 */
export function getAllMetadata(target: unknown): AllMetadata {
  return {
    trackable: getTrackableConfig(target),
    searchable: getSearchableConfig(target),
    fileNaming: getFileNamingConfig(target),
    trackableProperties: getTrackableProperties(target),
    searchableProperties: getSearchableProperties(target),
    nonSerialisedProperties: getNonSerialisedProperties(target),
    separateFilesProperties: getSeparateFilesProperties(target),
    separateFoldersProperties: getSeparateFoldersProperties(target)
  }
}

/**
 * Serialize an object respecting @NonSerialised decorators
 */
export function serializeWithDecorators(target: unknown, obj: Record<string, unknown>): Record<string, unknown> {
  const nonSerialised = getNonSerialisedProperties(target)
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (!nonSerialised.has(key)) {
      result[key] = value
    }
  }

  return result
}

/**
 * @separateFolders Decorator
 */

import { METADATA_KEYS, setPropertyMetadata, getPropertyMetadata, getAllPropertyMetadata } from './metadata'

/**
 * Configuration for separate folders behavior
 */
export interface SeparateFoldersConfig {
  /** Folder naming pattern (default: uses item name) */
  folderNaming?: string
}

/**
 * Mark a property as stored in separate folders.
 * Items in this array property will each be saved to their own folder.
 */
export function separateFolders(config?: SeparateFoldersConfig): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SEPARATE_FOLDERS, {
      folderNaming: config?.folderNaming
    })
  }
}

/**
 * Check if a property uses separate folders
 */
export function hasSeparateFolders(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FOLDERS) !== undefined
}

/**
 * Get separate folders config for a property
 */
export function getSeparateFoldersConfig(target: unknown, propertyKey: string | symbol): SeparateFoldersConfig | undefined {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FOLDERS) as SeparateFoldersConfig | undefined
}

/**
 * Get all properties with separate folders
 */
export function getSeparateFoldersProperties(target: unknown): Map<string | symbol, SeparateFoldersConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SEPARATE_FOLDERS) as Map<string | symbol, SeparateFoldersConfig>
}

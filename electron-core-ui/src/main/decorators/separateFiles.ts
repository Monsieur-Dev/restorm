/**
 * @separateFiles Decorator
 */

import { METADATA_KEYS, setPropertyMetadata, getPropertyMetadata, getAllPropertyMetadata } from './metadata'

/**
 * Configuration for separate files behavior
 */
export interface SeparateFilesConfig {
  /** File extension to use (default: inherited from parent) */
  extension?: string
}

/**
 * Mark a property as stored in separate files.
 * Items in this array property will each be saved to their own file.
 */
export function separateFiles(config?: SeparateFilesConfig): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SEPARATE_FILES, {
      extension: config?.extension
    })
  }
}

/**
 * Check if a property uses separate files
 */
export function hasSeparateFiles(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FILES) !== undefined
}

/**
 * Get separate files config for a property
 */
export function getSeparateFilesConfig(target: unknown, propertyKey: string | symbol): SeparateFilesConfig | undefined {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FILES) as SeparateFilesConfig | undefined
}

/**
 * Get all properties with separate files
 */
export function getSeparateFilesProperties(target: unknown): Map<string | symbol, SeparateFilesConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SEPARATE_FILES) as Map<string | symbol, SeparateFilesConfig>
}

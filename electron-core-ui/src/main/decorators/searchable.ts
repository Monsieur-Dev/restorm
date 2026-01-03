/**
 * @searchable Decorator
 */

import { METADATA_KEYS, getClassMetadata, setClassMetadata, setPropertyMetadata, getAllPropertyMetadata } from './metadata'

/**
 * Configuration for searchable properties
 */
export interface SearchableConfig {
  /** Weight for search ranking (higher = more important) */
  weight?: number
  /** Whether to include in full-text search */
  fullText?: boolean
  /** Whether to use for filtering */
  filterable?: boolean
}

/**
 * Mark a class as searchable.
 * When applied to a class, configures default search behavior.
 */
export function searchable(config?: SearchableConfig): ClassDecorator {
  return (target: object) => {
    setClassMetadata(target, METADATA_KEYS.SEARCHABLE, {
      weight: config?.weight ?? 1,
      fullText: config?.fullText ?? true,
      filterable: config?.filterable ?? false
    })
  }
}

/**
 * Mark a specific property as searchable.
 * The property value will be included in the search index.
 */
searchable.property = (config?: SearchableConfig): PropertyDecorator => {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SEARCHABLE, {
      weight: config?.weight ?? 1,
      fullText: config?.fullText ?? true,
      filterable: config?.filterable ?? false
    })
  }
}

/**
 * Check if a class is searchable
 */
export function isSearchable(target: unknown): boolean {
  return getClassMetadata(target, METADATA_KEYS.SEARCHABLE) !== undefined
}

/**
 * Get searchable config for a class
 */
export function getSearchableConfig(target: unknown): SearchableConfig | undefined {
  return getClassMetadata(target, METADATA_KEYS.SEARCHABLE) as SearchableConfig | undefined
}

/**
 * Get searchable properties for a class
 */
export function getSearchableProperties(target: unknown): Map<string | symbol, SearchableConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SEARCHABLE) as Map<string | symbol, SearchableConfig>
}

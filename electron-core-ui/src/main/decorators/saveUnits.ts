/**
 * @saveUnits Decorator
 */

import { METADATA_KEYS, setPropertyMetadata, getPropertyMetadata, getAllPropertyMetadata } from './metadata'

/**
 * Configuration for save-unit behavior
 */
export interface SaveUnitsConfig {
  /** Unit naming pattern (default: uses item name) */
  unitNaming?: string
}

/**
 * Mark an array property whose items are each their own SAVE UNIT: the
 * decomposer walks them into independent entries so per-unit dirty
 * state, drafts and per-unit Ctrl+S can address them individually.
 */
export function saveUnits(config?: SaveUnitsConfig): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SAVE_UNITS, {
      unitNaming: config?.unitNaming
    })
  }
}

/**
 * Check if a property's items are save units
 */
export function hasSaveUnits(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SAVE_UNITS) !== undefined
}

/**
 * Get save-units config for a property
 */
export function getSaveUnitsConfig(target: unknown, propertyKey: string | symbol): SaveUnitsConfig | undefined {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SAVE_UNITS) as SaveUnitsConfig | undefined
}

/**
 * Get all properties whose items are save units
 */
export function getSaveUnitsProperties(target: unknown): Map<string | symbol, SaveUnitsConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SAVE_UNITS) as Map<string | symbol, SaveUnitsConfig>
}

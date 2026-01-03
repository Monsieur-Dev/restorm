/**
 * @trackable Decorator
 */

import { METADATA_KEYS, getClassMetadata, setClassMetadata, setPropertyMetadata, getAllPropertyMetadata } from './metadata'

/**
 * Configuration for trackable properties
 */
export interface TrackableConfig {
  /** Whether this property triggers change detection (default: true) */
  enabled?: boolean
  /** Debounce delay in ms before emitting change event (default: 50) */
  debounceMs?: number
}

/**
 * Mark a class as trackable for change detection.
 * When applied to a class, all properties trigger change events by default.
 */
export function trackable(config?: TrackableConfig): ClassDecorator {
  return (target: object) => {
    setClassMetadata(target, METADATA_KEYS.TRACKABLE, {
      enabled: config?.enabled ?? true,
      debounceMs: config?.debounceMs ?? 50
    })
  }
}

/**
 * Mark a specific property as trackable.
 * Use this to override class-level tracking for specific properties.
 */
trackable.property = (config?: TrackableConfig): PropertyDecorator => {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.TRACKABLE, {
      enabled: config?.enabled ?? true,
      debounceMs: config?.debounceMs ?? 50
    })
  }
}

/**
 * Check if a class is trackable
 */
export function isTrackable(target: unknown): boolean {
  const config = getClassMetadata(target, METADATA_KEYS.TRACKABLE) as TrackableConfig | undefined
  return config?.enabled ?? false
}

/**
 * Get trackable config for a class
 */
export function getTrackableConfig(target: unknown): TrackableConfig | undefined {
  return getClassMetadata(target, METADATA_KEYS.TRACKABLE) as TrackableConfig | undefined
}

/**
 * Get trackable properties for a class
 */
export function getTrackableProperties(target: unknown): Map<string | symbol, TrackableConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.TRACKABLE) as Map<string | symbol, TrackableConfig>
}

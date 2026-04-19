/**
 * Runtime types for tracking objects across the dirty-state and
 * save-unit pipelines.
 */

/**
 * Runtime-only identifier for tracking individual object instances.
 * Generated at load/creation time, not persisted.
 */
export type RuntimeId = string

/**
 * Interface for objects that have a runtime identifier.
 */
export interface HasRuntimeId {
  /** Runtime-only identifier, excluded from serialization */
  id: RuntimeId
}

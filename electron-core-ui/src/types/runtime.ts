/**
 * Runtime types for tracking objects and dirty state management
 */

/**
 * Runtime-only identifier for tracking individual object instances.
 * Used for dirty state tracking, change detection, and UI reconciliation.
 *
 * RuntimeIds are:
 * - Generated at runtime when objects are loaded/created
 * - NOT persisted to files (excluded from serialization)
 * - Used as keys in tracking maps for checksums and dirty state
 */
export type RuntimeId = string

/**
 * Interface for objects that have a runtime identifier
 */
export interface HasRuntimeId {
  /** Runtime-only identifier, excluded from serialization */
  id: RuntimeId
}

/**
 * Checksum entry for tracking object state
 */
export interface ChecksumEntry {
  /** The runtime ID of the tracked object */
  runtimeId: RuntimeId
  /** SHA-256 or similar checksum of the object's serialized state */
  checksum: string
}

/**
 * Map of runtime IDs to their checksums
 */
export type ChecksumMap = Map<RuntimeId, string>

/**
 * Dirty state tracking result
 */
export interface DirtyStateResult {
  /** Whether the overall state is dirty */
  isDirty: boolean
  /** List of runtime IDs that have changed */
  changedIds: RuntimeId[]
  /** List of runtime IDs that are new (not in saved state) */
  newIds: RuntimeId[]
  /** List of runtime IDs that were deleted (in saved state but not current) */
  deletedIds: RuntimeId[]
}

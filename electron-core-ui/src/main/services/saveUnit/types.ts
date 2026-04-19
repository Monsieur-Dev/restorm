/**
 * Save unit types.
 *
 * A save unit is the atomic persistence object in memory: any document
 * object that has its own presence on disk (a request, a folder, the
 * root environment, …). Each unit keeps a `reference` (last state
 * synced with disk) and an optional `draft` (pending change). The unit
 * is dirty whenever a draft exists.
 */

import type { RuntimeId } from '../../../types/runtime'

/** Kind of on-disk entry this unit maps to. */
export type SaveUnitKind = 'file' | 'folder'

/** Reason a unit last transitioned to a dirty state. */
export type DirtyReason = 'modify' | 'create' | 'delete' | 'rename' | 'move' | 'reorder'

/**
 * Sentinel draft shape for a unit the user has deleted. The `snapshot`
 * field carries the full `reference` state at delete time so Ctrl+Z
 * before save can undo the deletion.
 */
export interface Tombstone {
  readonly __tombstone: true
  readonly snapshot: unknown
}

/** Narrow a draft value to check whether it is a tombstone. */
export function isTombstone(value: unknown): value is Tombstone {
  return typeof value === 'object' && value !== null && (value as { __tombstone?: unknown }).__tombstone === true
}

/** Build a tombstone draft from a reference snapshot. */
export function makeTombstone(snapshot: unknown): Tombstone {
  return { __tombstone: true, snapshot }
}

/**
 * The in-memory save unit.
 *
 * - `reference === undefined` and `draft !== undefined` → freshly created (create).
 * - `reference !== undefined` and `draft === undefined`  → clean, in sync with disk.
 * - `reference !== undefined` and `draft !== undefined` → modify / rename / move / reorder.
 * - `reference !== undefined` and `isTombstone(draft)` → pending delete.
 */
export interface SaveUnit {
  /** Stable identity across renames and moves. */
  readonly runtimeId: RuntimeId
  /** File vs folder — drives which temp-rename pattern the save uses. */
  readonly kind: SaveUnitKind
  /** Id of the parent unit in the tree, or `undefined` for the root. */
  parentId: RuntimeId | undefined
  /** Last state synchronized with disk. `undefined` for units that were just created. */
  reference: unknown
  /** Pending change. `undefined` = not dirty. `Tombstone` = pending delete. */
  draft: unknown
  /** Reason for the most recent dirty transition (for event payloads). */
  lastDirtyReason: DirtyReason | undefined
}

/**
 * Snapshot returned by the registry for each dirty unit in a change
 * event. Kept separate from the live `SaveUnit` so consumers never
 * mutate the internal state.
 */
export interface UnitChangeSnapshot {
  readonly runtimeId: RuntimeId
  readonly isDirty: boolean
  readonly reason: DirtyReason | undefined
}

/** Predicates. */
export function isUnitDirty(unit: SaveUnit): boolean {
  return unit.draft !== undefined
}

export function isUnitPendingDelete(unit: SaveUnit): boolean {
  return isTombstone(unit.draft)
}

export function isUnitNew(unit: SaveUnit): boolean {
  return unit.reference === undefined && unit.draft !== undefined && !isTombstone(unit.draft)
}

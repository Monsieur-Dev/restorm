/**
 * In-memory registry of save units.
 *
 * Owns the reference / draft state of every persistable document object.
 * Provides the operations the file service needs to carry out a save
 * cycle: mutate (modify / rename / move / reorder), delete, commit,
 * revert. Does NOT touch the filesystem — that's the file service's
 * responsibility. The registry is pure state + event emission.
 */

import type { RuntimeId } from '../../../types/runtime'
import {
  isTombstone,
  isUnitDirty,
  makeTombstone,
  type DirtyReason,
  type SaveUnit,
  type SaveUnitKind,
  type Tombstone,
  type UnitChangeSnapshot
} from './types'

export type UnitChangeListener = (snapshot: UnitChangeSnapshot) => void

/**
 * Compare two values by their canonical persisted form (sorted-key
 * `JSON.stringify`). Slower than `sameShape` but sees through field-
 * order differences and ignores `undefined`-valued keys — the same
 * normalization the persistence layer applies before writing to disk.
 * Used as a fall-back from `sameShape` so a logical revert that
 * round-trips through the upsert pipeline (which may permute key
 * order or add a transient `undefined`) still discards its draft.
 */
function sameSerialized(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/**
 * Input contract: callers pass plain-JSON values (already cleansed
 * by `cleanseForPersistence` / `decomposeForPersistence` upstream).
 * Class instances such as `Date`, `Map`, `Set` would collapse to `{}`
 * here because they have no own enumerable string keys — that would
 * falsely compare equal to other empty objects. Inputs that have
 * already round-tripped through serialization don't carry such
 * instances, so this is safe in practice.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
    const obj = v as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) {
      // Strip undefined / empty-string keys — both round-trip to "no
      // key" through the persistence layer (YAML elides empty values,
      // the decomposer's cleanse path doesn't preserve them, and a
      // class field declared as `notes?: string` (with
      // `useDefineForClassFields: true`) emits a `notes: undefined`
      // own property that JSON.stringify drops, leaving the reference
      // shape devoid of `notes`. The first time the user types into
      // the notes editor and clears it, the reactive proxy assigns
      // `notes = ''` and JSON.stringify keeps it — diverging from the
      // reference. Treating empty-string and undefined as equivalent
      // to "absent" closes that asymmetry and unblocks the first
      // edit-then-undo cycle on a freshly-opened file.
      if (obj[k] === undefined) continue
      if (obj[k] === '') continue
      sorted[k] = obj[k]
    }
    return sorted
  })
}

/**
 * Deep-equal for plain JSON-shaped values. Used to decide whether a
 * `mutate()` actually changed anything — if the candidate draft is
 * structurally identical to the reference, the draft is discarded.
 */
function sameShape(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!sameShape(a[i], b[i])) return false
    }
    return true
  }
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b as object).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i += 1) if (aKeys[i] !== bKeys[i]) return false
  for (const key of aKeys) {
    if (!sameShape((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

export class SaveUnitRegistry {
  private readonly units = new Map<RuntimeId, SaveUnit>()
  private readonly listeners = new Set<UnitChangeListener>()

  // ── Lookup ─────────────────────────────────────────────────────────

  get(runtimeId: RuntimeId): SaveUnit | undefined {
    return this.units.get(runtimeId)
  }

  has(runtimeId: RuntimeId): boolean {
    return this.units.has(runtimeId)
  }

  list(): SaveUnit[] {
    return [...this.units.values()]
  }

  listDirty(): SaveUnit[] {
    const out: SaveUnit[] = []
    for (const unit of this.units.values()) {
      if (isUnitDirty(unit)) out.push(unit)
    }
    return out
  }

  isDirty(runtimeId: RuntimeId): boolean {
    const unit = this.units.get(runtimeId)
    return unit !== undefined && isUnitDirty(unit)
  }

  isGlobalDirty(): boolean {
    for (const unit of this.units.values()) {
      if (isUnitDirty(unit)) return true
    }
    return false
  }

  dirtyCount(): number {
    let n = 0
    for (const unit of this.units.values()) {
      if (isUnitDirty(unit)) n += 1
    }
    return n
  }

  // ── Hydration from disk ────────────────────────────────────────────

  /**
   * Record a unit as clean — use when loading a file from disk. No
   * draft is created; the unit is immediately in sync.
   */
  hydrate(params: {
    runtimeId: RuntimeId
    kind: SaveUnitKind
    reference: unknown
    parentId?: RuntimeId | undefined
  }): void {
    // Capture the pre-hydration dirty state so we can fire the
    // `onUnitChange(clean)` event when re-hydration wipes a draft —
    // e.g. the renderer re-hydrates every unit after a whole-file save
    // to reset references in lockstep.
    const existing = this.units.get(params.runtimeId)
    const wasDirty = existing !== undefined && isUnitDirty(existing)
    const unit: SaveUnit = {
      runtimeId: params.runtimeId,
      kind: params.kind,
      parentId: params.parentId,
      reference: params.reference,
      draft: undefined,
      lastDirtyReason: undefined
    }
    this.units.set(params.runtimeId, unit)
    if (wasDirty) {
      this.emit(params.runtimeId, false, undefined)
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /**
   * Create a brand-new unit (no disk presence yet). The unit is dirty
   * from the start with `reason = 'create'`.
   */
  create(params: {
    runtimeId: RuntimeId
    kind: SaveUnitKind
    draft: unknown
    parentId?: RuntimeId | undefined
  }): void {
    if (this.units.has(params.runtimeId)) {
      throw new Error(`[SaveUnitRegistry] create: unit "${params.runtimeId}" already exists`)
    }
    const unit: SaveUnit = {
      runtimeId: params.runtimeId,
      kind: params.kind,
      parentId: params.parentId,
      reference: undefined,
      draft: params.draft,
      lastDirtyReason: 'create'
    }
    this.units.set(params.runtimeId, unit)
    this.emit(params.runtimeId, true, 'create')
  }

  /**
   * Update a unit's content. If the new draft is structurally identical
   * to the reference, the draft is discarded (the user undid their
   * change before saving). Emits a dirty-state change only when the
   * unit's `isDirty` status actually flips.
   */
  mutate(runtimeId: RuntimeId, draft: unknown, reason: DirtyReason = 'modify'): void {
    const unit = this.units.get(runtimeId)
    if (!unit) throw new Error(`[SaveUnitRegistry] mutate: unknown unit "${runtimeId}"`)
    const wasDirty = isUnitDirty(unit)

    if (unit.reference !== undefined && sameShape(draft, unit.reference)) {
      // Revert: user brought the data back to the reference state.
      unit.draft = undefined
      unit.lastDirtyReason = undefined
      if (wasDirty) this.emit(runtimeId, false, 'modify')
      return
    }
    // sameShape miss is the typical case for live edits, but it can
    // also fire on a logical revert when the upsert pipeline added a
    // transient field (e.g. a UI-only flag) the hydrate path didn't
    // see. The serialized JSON is the canonical persistence shape —
    // if both sides serialize identically, the user is back at the
    // saved baseline and the draft must be discarded.
    if (unit.reference !== undefined && sameSerialized(draft, unit.reference)) {
      unit.draft = undefined
      unit.lastDirtyReason = undefined
      if (wasDirty) this.emit(runtimeId, false, 'modify')
      return
    }
    unit.draft = draft
    unit.lastDirtyReason = reason
    this.emit(runtimeId, true, reason)
  }

  /**
   * Force every unit to its clean state. Drops every `draft` (and
   * any tombstone) and emits an `onUnitChange(clean)` for each unit
   * that was previously dirty. Use when the in-memory tree is known
   * to match the on-disk reference but the registry hasn't caught
   * up — typical case is an edit-then-revert cycle whose `mutate`
   * couldn't `sameShape`-match because of a serialization round-trip
   * asymmetry. The bridge picks the per-unit `clean` events up and
   * deletes any draft files that linger.
   */
  markAllClean(): void {
    for (const [runtimeId, unit] of this.units) {
      const wasDirty = isUnitDirty(unit)
      if (!wasDirty) continue
      unit.draft = undefined
      unit.lastDirtyReason = undefined
      this.emit(runtimeId, false, undefined)
    }
  }

  /** Mark a unit as pending-delete. Idempotent: calling twice is a no-op. */
  markDeleted(runtimeId: RuntimeId): void {
    const unit = this.units.get(runtimeId)
    if (!unit) throw new Error(`[SaveUnitRegistry] markDeleted: unknown unit "${runtimeId}"`)
    if (isTombstone(unit.draft)) return
    if (unit.reference === undefined) {
      // Deleting a never-saved unit: nothing to persist — just drop it.
      this.units.delete(runtimeId)
      this.emit(runtimeId, false, 'delete')
      return
    }
    const tombstone: Tombstone = makeTombstone(unit.reference)
    unit.draft = tombstone
    unit.lastDirtyReason = 'delete'
    this.emit(runtimeId, true, 'delete')
  }

  /** Change the parent of a unit (tree move). Dirties the unit. */
  move(runtimeId: RuntimeId, newParentId: RuntimeId | undefined): void {
    const unit = this.units.get(runtimeId)
    if (!unit) throw new Error(`[SaveUnitRegistry] move: unknown unit "${runtimeId}"`)
    if (unit.parentId === newParentId) return
    unit.parentId = newParentId
    if (unit.draft === undefined && unit.reference !== undefined) {
      // Use a structured clone of the reference as the new draft so the
      // move becomes a committable change.
      unit.draft = structuredClone(unit.reference)
    }
    unit.lastDirtyReason = 'move'
    this.emit(runtimeId, true, 'move')
  }

  // ── Commit / revert ────────────────────────────────────────────────

  /**
   * Apply the draft as the new reference. Called by the file service
   * after a successful disk write. Non-tombstone drafts become the new
   * reference; tombstones cause the unit to be removed entirely.
   */
  commit(runtimeId: RuntimeId): void {
    const unit = this.units.get(runtimeId)
    if (!unit) return
    if (unit.draft === undefined) return
    if (isTombstone(unit.draft)) {
      this.units.delete(runtimeId)
      this.emit(runtimeId, false, undefined)
      return
    }
    unit.reference = unit.draft
    unit.draft = undefined
    unit.lastDirtyReason = undefined
    this.emit(runtimeId, false, undefined)
  }

  /**
   * Commit **only if** the current draft is structurally identical to
   * `expectedDraft`. Used by the file service to avoid clobbering a
   * newer edit that landed between the caller's snapshot and the disk
   * write — callers pass the exact value they just persisted. Returns
   * `true` when the commit proceeds, `false` when the draft has moved
   * on (in which case the unit stays dirty and its draft is left intact).
   */
  commitIfDraftMatches(runtimeId: RuntimeId, expectedDraft: unknown): boolean {
    const unit = this.units.get(runtimeId)
    if (!unit) return false
    if (unit.draft === undefined) return false
    if (!sameShape(unit.draft, expectedDraft)) return false
    this.commit(runtimeId)
    return true
  }

  /** Discard the draft, reverting to the on-disk reference. */
  revert(runtimeId: RuntimeId): void {
    const unit = this.units.get(runtimeId)
    if (!unit) return
    if (unit.draft === undefined) return
    if (unit.reference === undefined) {
      // Never-saved unit: revert = destroy.
      this.units.delete(runtimeId)
      this.emit(runtimeId, false, undefined)
      return
    }
    unit.draft = undefined
    unit.lastDirtyReason = undefined
    this.emit(runtimeId, false, undefined)
  }

  /** Drop every registered unit. Used when closing the project. */
  clear(): void {
    this.units.clear()
    // No per-unit events emitted — the file service fires a close event instead.
  }

  // ── Events ─────────────────────────────────────────────────────────

  onUnitChange(listener: UnitChangeListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(runtimeId: RuntimeId, isDirty: boolean, reason: DirtyReason | undefined): void {
    const snapshot: UnitChangeSnapshot = { runtimeId, isDirty, reason }
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* swallow — registries mustn't throw on listener errors */ }
    }
  }
}

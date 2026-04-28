import type { ImportSelectionSnapshot } from '../../../shared/types/baseTypes'
import type { NormalizedSpec } from '../import/idempotent/types'

/**
 * Per-key classification produced by the refresh wizard's diff
 * resolver. Five buckets:
 *
 * - `unchanged`: present in the spec, present in the old
 *   `imported` set, and structurally identical (same fingerprint).
 *   Renders compact + no action UI.
 * - `added`: present in the spec, absent from both `imported` and
 *   `skipped` of the previous snapshot. The user has never seen it
 *   before. Default decision: import.
 * - `modified`: present in the spec, present in `imported`,
 *   structurally different from the snapshot. Default decision:
 *   apply the merge.
 * - `removed`: in the old `imported` set, absent from the new spec.
 *   Default decision: mark as removed (still callable).
 * - `previouslySkipped`: in the spec, in the old `skipped` set.
 *   Default decision: keep skipping unless the user explicitly opts
 *   in.
 *
 * Pure helper so the resolver can be unit-tested without spinning up
 * a renderer.
 */
export type RefreshStatus =
  | 'unchanged'
  | 'added'
  | 'modified'
  | 'removed'
  | 'previouslySkipped'

export interface RefreshDiff {
  byNaturalKey: Map<string, RefreshStatus>
  counts: Record<RefreshStatus, number>
  /** Convenience: spec.version when available. */
  newVersion?: string
}

/**
 * Compute the per-natural-key classification used by the refresh
 * wizard. Folders + their leaves are not distinguished here — the
 * resolver works at the operation / model / enum natural-key level
 * because that's the granularity the snapshot persists.
 *
 * `fingerprintBySpecKey` lets the caller pin a structural digest
 * for "modified" detection. Without it, every `imported` key still
 * present in the new spec is classified as `unchanged`.
 */
export interface ResolveRefreshDiffInput {
  oldSnapshot: ImportSelectionSnapshot | undefined
  newSpec: NormalizedSpec
  /** Optional structural fingerprint per natural key from the new
   * spec. Compared against the snapshot's previous fingerprint when
   * available; mismatch → `modified`. Implementations typically pass
   * a JSON-stringified shape. */
  fingerprintBySpecKey?: ReadonlyMap<string, string>
  /** Optional per-natural-key fingerprint from the snapshot. Stored
   * by the apply step on the previous successful refresh. */
  fingerprintBySnapshotKey?: ReadonlyMap<string, string>
}

function specNaturalKeys(spec: NormalizedSpec): Set<string> {
  const keys = new Set<string>()
  for (const op of spec.operations) keys.add(op.naturalKey)
  for (const m of spec.models) keys.add(`model:${m.name}`)
  for (const e of spec.enums) keys.add(`enum:${e.name}`)
  return keys
}

export function resolveRefreshDiff(input: ResolveRefreshDiffInput): RefreshDiff {
  const byNaturalKey = new Map<string, RefreshStatus>()
  const counts: Record<RefreshStatus, number> = {
    unchanged: 0,
    added: 0,
    modified: 0,
    removed: 0,
    previouslySkipped: 0
  }

  const oldImported = new Set(input.oldSnapshot?.imported ?? [])
  const oldSkipped = new Set(input.oldSnapshot?.skipped ?? [])
  const inSpec = specNaturalKeys(input.newSpec)

  for (const key of inSpec) {
    if (oldImported.has(key)) {
      const before = input.fingerprintBySnapshotKey?.get(key)
      const after = input.fingerprintBySpecKey?.get(key)
      const status: RefreshStatus = before !== undefined && after !== undefined && before !== after
        ? 'modified'
        : 'unchanged'
      byNaturalKey.set(key, status)
      counts[status] += 1
      continue
    }
    if (oldSkipped.has(key)) {
      byNaturalKey.set(key, 'previouslySkipped')
      counts.previouslySkipped += 1
      continue
    }
    byNaturalKey.set(key, 'added')
    counts.added += 1
  }

  for (const key of oldImported) {
    if (inSpec.has(key)) continue
    byNaturalKey.set(key, 'removed')
    counts.removed += 1
  }

  const result: RefreshDiff = { byNaturalKey, counts }
  if (input.newSpec.version !== undefined) result.newVersion = input.newSpec.version
  return result
}

/**
 * Default "Apply" decision per status, matching the ticket's
 * specification:
 *
 * - `added` / `modified` → checked.
 * - `unchanged` → checked (no-op anyway, but keeps the UI honest:
 *   unchecking it would translate to "skip going forward").
 * - `removed` / `previouslySkipped` → unchecked.
 */
export function defaultDecisionFor(status: RefreshStatus): boolean {
  switch (status) {
    case 'added':
    case 'modified':
    case 'unchanged':
      return true
    case 'removed':
    case 'previouslySkipped':
      return false
  }
}

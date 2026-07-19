import { useCallback, useMemo, useState } from 'react'
import type { GitConflictVersions } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/folderTypes'
import type { Scenario } from '../../../shared/types/scenario'
import { identifyConflictingEntities, type ConflictEntity } from '../../../shared/git/gitConflictModel'
import { cloneEntityForResolution } from '../services/conflictEntityClone'
import { computeEntityFieldDiff } from '../services/conflictFieldDiff'
import { processAfterDeserialization } from '../utils/serialization'

/** Per-config ours/theirs overrides, keyed conflictId → configName → side. */
export type QuickConfigPicks = Record<string, Record<string, 'ours' | 'theirs'>>

export interface UseConflictResolutionResult {
  conflicts: ConflictEntity[]
  selectedConflictId: string | null
  selectConflict: (id: string) => void
  /** The current editable "resolved" copy for a conflict — defaults to a
   * clone of `ours` the first time a conflict is seen. */
  getResolvedEntity: (conflictId: string) => FolderItem
  /** AC#3: "use this version" — replaces the resolved copy with a fresh
   * clone of `ours`/`theirs`, discarding any edits made so far. */
  pickOursVersion: (conflictId: string) => void
  pickTheirsVersion: (conflictId: string) => void
  /** Scenarios are controlled via this callback rather than in-place proxy
   * mutation (see `conflictEntityClone.ts`) — wire it to `ScenarioEditorView.
   * onScenarioChange` for the resolved panel. */
  onScenarioChange: (conflictId: string, patch: { nodes?: Scenario['nodes'], edges?: Scenario['edges'], notes?: string }) => void
  /** Per-config ours/theirs overrides for conflicting saved quick-configs
   * (same name on both sides, different content). Absent for a config =
   * follow whatever the whole-entity pick resolved it to (the safe-floor).
   * These are recorded as plain state and applied to the resolved entity's
   * `quickConfigs` only at write-back — never by mutating the reactive
   * resolved proxy, so the resolved panel's in-progress edits survive. */
  quickConfigPicks: QuickConfigPicks
  /** Record a finer-than-whole-entity ours/theirs choice for ONE conflicting
   * saved quick-config, independent of the whole-entity pick. */
  pickQuickConfigVersion: (conflictId: string, configName: string, side: 'ours' | 'theirs') => void
  /** Per-conflict pick counter — remount key for the resolved panel. */
  resolvedEpochById: Record<string, number>
  /** DERIVED, not event-tracked: which side the resolved copy currently
   * EQUALS (per the same field comparison the diff highlighting uses) —
   * 'user' when it matches ours, 'server' when it matches theirs, null
   * otherwise. Hand-editing the resolved copy back into equality with a
   * side re-greens that side's check with no pick needed. */
  pickedSideById: Record<string, 'user' | 'server' | null>
  /** Report a hand edit of the resolved panel. The resolved entities are
   * reactive proxies mutated in place (no React state change), so this
   * bump is what triggers re-deriving `pickedSideById`. */
  onResolvedEdited: (conflictId: string) => void
}

function isScenarioItem(item: FolderItem): item is Scenario {
  return (item as { type?: string }).type === 'scenario'
}

/** Whether the resolved copy equals one side, using the SAME comparison the
 * diff highlighting is built on (`computeEntityFieldDiff`) so "the check is
 * green" and "nothing is red-bordered against that side" can never disagree.
 * Scenario kinds aren't field-diffed — compare their graph + notes instead. */
function resolvedEqualsSide(conflict: ConflictEntity, resolved: FolderItem, side: FolderItem): boolean {
  const diff = computeEntityFieldDiff(conflict.kind, resolved, side)
  if (diff) {
    return Object.values(diff.fields).every((differs) => !differs) && !diff.conflictingQuickConfigNames?.length
  }
  if (isScenarioItem(resolved) && isScenarioItem(side)) {
    return JSON.stringify([resolved.nodes, resolved.edges, resolved.notes ?? '']) ===
      JSON.stringify([side.nodes, side.edges, side.notes ?? ''])
  }
  return false
}

function buildInitialResolved(conflicts: ConflictEntity[]): Record<string, FolderItem> {
  const resolved: Record<string, FolderItem> = {}
  for (const conflict of conflicts) {
    resolved[conflict.id] = cloneEntityForResolution(conflict.ours)
  }
  return resolved
}

/**
 * Owns the conflict-resolution session's state for a single pull conflict:
 * which entities conflict (`identifyConflictingEntities`), which one is
 * selected, and each one's editable "resolved" copy. A fresh
 * `GitConflictVersions` (a new pull attempt) resets the whole session —
 * handled by adjusting state during render when `conflicts` changes
 * identity, the React-recommended alternative to an effect that would
 * otherwise call `setState` synchronously on mount
 * (https://react.dev/learn/you-might-not-need-an-effect).
 */
export function useConflictResolution(versions: GitConflictVersions | null): UseConflictResolutionResult {
  const conflicts = useMemo(
    () => (versions ? identifyConflictingEntities(versions, processAfterDeserialization) : []),
    [versions]
  )

  const [priorConflicts, setPriorConflicts] = useState(conflicts)
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(conflicts[0]?.id ?? null)
  const [resolvedById, setResolvedById] = useState<Record<string, FolderItem>>(() => buildInitialResolved(conflicts))
  const [quickConfigPicks, setQuickConfigPicks] = useState<QuickConfigPicks>({})
  // Bumped on every ours/theirs PICK (never on a manual edit): the resolved
  // panel's tab view seeds its editable fields into local state once, so a
  // pick that swaps the resolved entity must REMOUNT the panel (key) for the
  // picked values to show — a plain re-render keeps the pre-pick fields.
  const [resolvedEpochById, setResolvedEpochById] = useState<Record<string, number>>({})
  // The resolved entities are reactive proxies mutated in place — hand edits
  // change no React state, so `pickedSideById` below could never re-derive
  // without this revision counter, bumped by `onResolvedEdited`. Only the
  // setter is needed: the value's sole job is forcing the re-render.
  const [, setResolvedRevision] = useState(0)

  if (conflicts !== priorConflicts) {
    setPriorConflicts(conflicts)
    setSelectedConflictId(conflicts[0]?.id ?? null)
    setResolvedById(buildInitialResolved(conflicts))
    setQuickConfigPicks({})
    setResolvedEpochById({})
    setResolvedRevision(0)
  }

  // Derived every render (kept fresh by `resolvedRevision` bumps and
  // `resolvedById` swaps): which column's check paints green. Deliberately
  // NOT tracking picks as events — Yoann's rule is pure equality: resolved
  // == ours → user check green; == theirs → server check green; else none.
  const pickedSideById: Record<string, 'user' | 'server' | null> = {}
  for (const conflict of conflicts) {
    const resolved = resolvedById[conflict.id]
    pickedSideById[conflict.id] = !resolved ? null
      : resolvedEqualsSide(conflict, resolved, conflict.ours) ? 'user'
        : resolvedEqualsSide(conflict, resolved, conflict.theirs) ? 'server'
          : null
  }

  const selectConflict = useCallback((id: string) => { setSelectedConflictId(id) }, [])

  const getResolvedEntity = useCallback((conflictId: string): FolderItem => {
    const resolved = resolvedById[conflictId]
    if (resolved) return resolved
    const conflict = conflicts.find((c) => c.id === conflictId)
    return conflict ? conflict.ours : ({} as FolderItem)
  }, [resolvedById, conflicts])

  const pickOursVersion = useCallback((conflictId: string) => {
    const conflict = conflicts.find((c) => c.id === conflictId)
    if (!conflict) return
    setResolvedById((prev) => ({ ...prev, [conflictId]: cloneEntityForResolution(conflict.ours) }))
    setResolvedEpochById((prev) => ({ ...prev, [conflictId]: (prev[conflictId] ?? 0) + 1 }))
  }, [conflicts])

  const pickTheirsVersion = useCallback((conflictId: string) => {
    const conflict = conflicts.find((c) => c.id === conflictId)
    if (!conflict) return
    setResolvedById((prev) => ({ ...prev, [conflictId]: cloneEntityForResolution(conflict.theirs) }))
    setResolvedEpochById((prev) => ({ ...prev, [conflictId]: (prev[conflictId] ?? 0) + 1 }))
  }, [conflicts])

  /** The resolved panel reports any hand edit here — re-derive the checks
   * (the edit may have broken equality with a side, or restored it). */
  const onResolvedEdited = useCallback((_conflictId: string) => {
    setResolvedRevision((revision) => revision + 1)
  }, [])

  const onScenarioChange = useCallback((
    conflictId: string,
    patch: { nodes?: Scenario['nodes'], edges?: Scenario['edges'], notes?: string }
  ) => {
    setResolvedById((prev) => {
      const current = prev[conflictId]
      if (!current || !isScenarioItem(current)) return prev
      return { ...prev, [conflictId]: { ...current, ...patch } }
    })
  }, [])

  const pickQuickConfigVersion = useCallback((conflictId: string, configName: string, side: 'ours' | 'theirs') => {
    setQuickConfigPicks((prev) => ({
      ...prev,
      [conflictId]: { ...(prev[conflictId] ?? {}), [configName]: side }
    }))
  }, [])

  return {
    conflicts,
    selectedConflictId,
    selectConflict,
    getResolvedEntity,
    pickOursVersion,
    pickTheirsVersion,
    onScenarioChange,
    quickConfigPicks,
    pickQuickConfigVersion,
    resolvedEpochById,
    pickedSideById,
    onResolvedEdited
  }
}

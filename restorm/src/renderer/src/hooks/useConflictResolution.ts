import { useCallback, useMemo, useState } from 'react'
import type { GitConflictVersions } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/folderTypes'
import type { Scenario } from '../../../shared/types/scenario'
import { identifyConflictingEntities, type ConflictEntity } from '../../../shared/git/gitConflictModel'
import { cloneEntityForResolution } from '../services/conflictEntityClone'
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
  /** Which side the resolved copy mirrors ('user'/'server'), null once hand-edited. */
  pickedSideById: Record<string, 'user' | 'server' | null>
  /** Report a hand edit of the resolved panel (clears the green checks). */
  onResolvedEdited: (conflictId: string) => void
}

function isScenarioItem(item: FolderItem): item is Scenario {
  return (item as { type?: string }).type === 'scenario'
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
  // Which side the resolved copy currently mirrors — drives the green check
  // on the matching version column. Cleared as soon as the user hand-edits
  // the resolved panel (the copy no longer equals either side verbatim).
  const [pickedSideById, setPickedSideById] = useState<Record<string, 'user' | 'server' | null>>({})

  if (conflicts !== priorConflicts) {
    setPriorConflicts(conflicts)
    setSelectedConflictId(conflicts[0]?.id ?? null)
    setResolvedById(buildInitialResolved(conflicts))
    setQuickConfigPicks({})
    setResolvedEpochById({})
    setPickedSideById({})
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
    setPickedSideById((prev) => ({ ...prev, [conflictId]: 'user' }))
  }, [conflicts])

  const pickTheirsVersion = useCallback((conflictId: string) => {
    const conflict = conflicts.find((c) => c.id === conflictId)
    if (!conflict) return
    setResolvedById((prev) => ({ ...prev, [conflictId]: cloneEntityForResolution(conflict.theirs) }))
    setResolvedEpochById((prev) => ({ ...prev, [conflictId]: (prev[conflictId] ?? 0) + 1 }))
    setPickedSideById((prev) => ({ ...prev, [conflictId]: 'server' }))
  }, [conflicts])

  /** The resolved panel reports any hand edit here — the copy then matches
   * neither side verbatim, so both green checks go out. */
  const onResolvedEdited = useCallback((conflictId: string) => {
    setPickedSideById((prev) => (prev[conflictId] ? { ...prev, [conflictId]: null } : prev))
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
    setPickedSideById((prev) => (prev[conflictId] ? { ...prev, [conflictId]: null } : prev))
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

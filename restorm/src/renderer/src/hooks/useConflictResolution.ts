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

  if (conflicts !== priorConflicts) {
    setPriorConflicts(conflicts)
    setSelectedConflictId(conflicts[0]?.id ?? null)
    setResolvedById(buildInitialResolved(conflicts))
    setQuickConfigPicks({})
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
  }, [conflicts])

  const pickTheirsVersion = useCallback((conflictId: string) => {
    const conflict = conflicts.find((c) => c.id === conflictId)
    if (!conflict) return
    setResolvedById((prev) => ({ ...prev, [conflictId]: cloneEntityForResolution(conflict.theirs) }))
  }, [conflicts])

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
    pickQuickConfigVersion
  }
}

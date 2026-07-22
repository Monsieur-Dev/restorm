import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitConflictVersions } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/folderTypes'
import type { Scenario } from '../../../shared/types/scenario'
import { identifyConflictingEntities, type ConflictEntity } from '../../../shared/git/gitConflictModel'
import { flattenEntities, parseProjectYaml } from '../../../shared/git/gitCommitDiff'
import { cloneEntityForResolution } from '../services/conflictEntityClone'
import { computeEntityFieldDiff } from '../services/conflictFieldDiff'
import { processAfterDeserialization } from '../utils/serialization'

/** Per-config ours/theirs overrides, keyed conflictId → configName → side. */
export type QuickConfigPicks = Record<string, Record<string, 'ours' | 'theirs'>>

export interface UseConflictResolutionResult {
  conflicts: ConflictEntity[]
  selectedConflictId: string | null
  selectConflict: (id: string) => void
  /** The current editable "resolved" copy for a conflict, or `null` while
   * the user has not chosen a side yet. */
  getResolvedEntity: (conflictId: string) => FolderItem | null
  /** True once the user has picked a side for this conflict. */
  isResolved: (conflictId: string) => boolean
  /** True when every conflict has been decided — the gate on finishing. */
  allResolved: boolean
  /** Rename the resolved copy. The name is arbitrated like any other
   * field, and the resolved column's box is editable so the user can
   * settle on a third name rather than only picking a side. */
  setResolvedName: (conflictId: string, name: string) => void
  /** Replace the resolved copy's tag list. Tags are arbitrated in their own
   * tab, so they need their own setter — the reactive proxy forbids raw
   * field assignment from outside. */
  setResolvedTags: (conflictId: string, tags: string[]) => void
  /** Look up any item of one side's project tree by id. A scenario node
   * bound to a request needs its target to render its summary, and in the
   * conflict view each column must resolve against ITS OWN side — showing
   * our request under the server's column would misrepresent the diff. */
  resolveItemOnSide: (side: 'ours' | 'theirs', itemId: string) => FolderItem | null
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

/**
 * A resolution session starts with NOTHING resolved.
 *
 * Pre-seeding each conflict with a clone of `ours` used to make the
 * resolved column look already decided: the user could reach the finish
 * button without ever opening the list, and silently publish our side of
 * every conflict they never looked at. An untouched conflict must read as
 * untouched — the choice is the user's to make, not ours to assume.
 */
function buildInitialResolved(): Record<string, FolderItem> {
  return {}
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
  const { t } = useTranslation()
  // The model is shared with the main process (no i18n there), so the
  // tree-structure entry's display name is supplied by this side.
  const treeConflictName = t('git.conflictTreeStructure')
  const conflicts = useMemo(
    () => (versions ? identifyConflictingEntities(versions, processAfterDeserialization, treeConflictName) : []),
    [versions, treeConflictName]
  )

  const [priorConflicts, setPriorConflicts] = useState(conflicts)
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(conflicts[0]?.id ?? null)
  const [resolvedById, setResolvedById] = useState<Record<string, FolderItem>>(buildInitialResolved)
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
    setResolvedById(buildInitialResolved())
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

  const getResolvedEntity = useCallback((conflictId: string): FolderItem | null => {
    return resolvedById[conflictId] ?? null
  }, [resolvedById])

  const isResolved = useCallback((conflictId: string): boolean => {
    return resolvedById[conflictId] !== undefined
  }, [resolvedById])

  const allResolved = conflicts.every((c) => resolvedById[c.id] !== undefined)

  // Each side's full tree, flattened once per versions object: the node
  // boxes call this per render, so re-walking the YAML every time would be
  // wasteful.
  const sideIndexes = useMemo(() => ({
    ours: flattenEntities(parseProjectYaml(versions?.ours ?? null, processAfterDeserialization)),
    theirs: flattenEntities(parseProjectYaml(versions?.theirs ?? null, processAfterDeserialization))
  }), [versions])

  const setResolvedName = useCallback((conflictId: string, name: string) => {
    setResolvedById((prev) => {
      const current = prev[conflictId]
      // Renaming presupposes a decision: with nothing picked there is no
      // resolved copy to rename yet.
      if (!current) return prev
      return { ...prev, [conflictId]: { ...(current as unknown as Record<string, unknown>), name } as unknown as FolderItem }
    })
  }, [])

  const setResolvedTags = useCallback((conflictId: string, tags: string[]) => {
    setResolvedById((prev) => {
      const current = prev[conflictId]
      if (!current) return prev
      return { ...prev, [conflictId]: { ...(current as unknown as Record<string, unknown>), tags } as unknown as FolderItem }
    })
  }, [])

  const resolveItemOnSide = useCallback((side: 'ours' | 'theirs', itemId: string): FolderItem | null => {
    return sideIndexes[side].get(itemId)?.item ?? null
  }, [sideIndexes])

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
    isResolved,
    allResolved,
    resolveItemOnSide,
    setResolvedName,
    pickOursVersion,
    pickTheirsVersion,
    onScenarioChange,
    quickConfigPicks,
    pickQuickConfigVersion,
    resolvedEpochById,
    pickedSideById,
    onResolvedEdited,
    setResolvedTags
  }
}

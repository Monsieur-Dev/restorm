import React, { useCallback, useMemo } from 'react'
import {
  ListView,
  Toggle,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import {
  importNaturalKeyForFolder,
  importNaturalKeyForRequest
} from '../../../../shared/utils/importNaturalKey'
import type { FolderItem } from '../../../../shared/types/folderTypes'
import type { Scenario, ApiDesign, RecordingSession } from '../../../../shared/types/collections'
import { isAnyFolder, isRequest, isScenario, isApiDesign, isRecordingSession } from '../../../../shared/types/collections'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { Badge } from '../common/Badge'
import { collectSelectableLeafKeys } from './importSelectionHelpers'

export interface ImportSelectionTreeProps {
  /**
   * Parsed-spec preview tree from `window.restorm.import.preview`.
   * The root entries are typically a single env folder containing
   * the actual content; the env folder root is rendered without a
   * Toggle (you can't opt out of the folder you're importing into).
   */
  items: FolderItem[]
  /**
   * Set of leaf natural keys the user wants to keep. Default
   * initialisation should pass every leaf so the tree starts fully
   * checked, matching the legacy "import everything" behaviour.
   */
  selection: ReadonlySet<string>
  /** Called whenever the selection changes — pass-through to React state. */
  onSelectionChange: (next: Set<string>) => void
  /** Filter rows by case-insensitive name substring. Empty = no filter. */
  searchFilter?: string
  /** Test id stem (e.g. `import-selection-tree`). */
  'data-testid'?: string
  /**
   * Optional status pill per leaf natural key. When present, the
   * matching pill renders in the row's `rightActions` slot. Used by
   * the refresh modal to show per-element status (added / modified
   * / removed / previously-skipped / unchanged) without forking the
   * tree component.
   */
  leafStatusByKey?: ReadonlyMap<string, RefreshLeafStatus>
  /**
   * Optional set of leaf keys whose checkbox should appear forced-on
   * and disabled. Locked leaves can't be unchecked individually, and
   * a folder Toggle clicked to "uncheck all" preserves the locked
   * leaves underneath. Used by the refresh modal: a leaf whose
   * operation is already present in the target folder can't sensibly
   * be opted out by the user, since opting out would silently drop a
   * route the folder already exposes.
   */
  lockedKeys?: ReadonlySet<string>
}

export type RefreshLeafStatus = 'added' | 'modified' | 'removed' | 'previouslySkipped' | 'unchanged'

/**
 * Decide the tri-state value for a folder row based on which of its
 * leaf descendants are in the selection. Pure function so the leaf /
 * folder UI stays consistent: a folder shows `'checked'` only when
 * every descendant is selected, `'unchecked'` only when none is, and
 * `'indeterminate'` otherwise.
 */
function folderStateFromSelection(
  leafKeys: readonly string[],
  selection: ReadonlySet<string>
): 'checked' | 'unchecked' | 'indeterminate' {
  if (leafKeys.length === 0) return 'unchecked'
  let anySelected = false
  let anyUnselected = false
  for (const k of leafKeys) {
    if (selection.has(k)) anySelected = true
    else anyUnselected = true
    if (anySelected && anyUnselected) return 'indeterminate'
  }
  return anySelected ? 'checked' : 'unchecked'
}

/**
 * Toggle every leaf descendant in a folder subtree to a target value.
 * Mutates a copy of the input set and returns it; the caller is
 * expected to feed the result back through React state. Locked leaves
 * are preserved on `next === false` so a folder-level "uncheck all"
 * doesn't silently strip a route the modal forced on.
 */
function setFolderSelection(
  leafKeys: readonly string[],
  selection: ReadonlySet<string>,
  next: boolean,
  lockedKeys: ReadonlySet<string> | undefined
): Set<string> {
  const out = new Set(selection)
  for (const k of leafKeys) {
    if (next) out.add(k)
    else if (!lockedKeys?.has(k)) out.delete(k)
  }
  return out
}

/**
 * Filter a tree by a case-insensitive name match. A folder is kept if
 * any of its descendants match (so the user can drill down to a hit
 * without losing the breadcrumb context). A leaf is kept only when
 * its own display name matches. The selection set is preserved
 * verbatim — filtering is purely a visibility concern, never edits
 * what's checked.
 */
function filterTree(items: readonly FolderItem[], q: string): FolderItem[] {
  if (!q) return [...items]
  const needle = q.toLowerCase()
  const out: FolderItem[] = []
  for (const item of items) {
    if (isAnyFolder(item)) {
      const childMatches = filterTree(item.items, q)
      const selfMatches = item.name.toLowerCase().includes(needle)
      if (selfMatches || childMatches.length > 0) {
        out.push({ ...item, items: childMatches.length > 0 ? childMatches : item.items })
      }
    } else if (isRequest(item)) {
      const name = item.name.toLowerCase()
      if (name.includes(needle)) out.push(item)
    }
  }
  return out
}

const LEAF_STATUS_PILL_STYLE: Record<RefreshLeafStatus, { label: string; color: string; background: string }> = {
  added: { label: 'Added', color: '#0a8f08', background: 'rgba(120, 200, 120, 0.18)' },
  modified: { label: 'Modified', color: '#a36a00', background: 'rgba(255, 180, 0, 0.18)' },
  removed: { label: 'Removed', color: '#b40000', background: 'rgba(244, 67, 54, 0.18)' },
  previouslySkipped: { label: 'Skipped', color: '#888', background: 'rgba(150, 150, 150, 0.18)' },
  unchanged: { label: 'Unchanged', color: '#888', background: 'rgba(150, 150, 150, 0.10)' }
}

function leafStatusPill(status: RefreshLeafStatus, testId: string | undefined): React.ReactNode {
  const style = LEAF_STATUS_PILL_STYLE[status]
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '10px',
        color: style.color,
        background: style.background
      }}
      {...(testId && { 'data-testid': testId })}
    >
      {style.label}
    </span>
  )
}

export const ImportSelectionTree: React.FC<ImportSelectionTreeProps> = ({
  items,
  selection,
  onSelectionChange,
  searchFilter = '',
  'data-testid': dataTestId,
  leafStatusByKey,
  lockedKeys
}) => {
  // Filter for display only — selection state stays scoped to the
  // unfiltered tree, so toggling rows under a search keeps the
  // checks for everything else intact.
  const visibleItems = useMemo(() => filterTree(items, searchFilter), [items, searchFilter])

  // Map each visible folder to its leaf-descendant keys once per
  // render so the tri-state derivation in the row renderer stays
  // O(1). Computed against the *original* tree so a folder's state
  // reflects its full subtree, not the filtered one — otherwise a
  // search hit on one route would make its parent folder appear
  // fully checked even when other unfiltered descendants are not.
  const leafKeysByFolderKey = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (subtree: readonly FolderItem[], path: readonly string[]): void => {
      for (const item of subtree) {
        if (isAnyFolder(item)) {
          const childPath = [...path, item.name]
          // Wrap `item` in a single-element list so `collectSelectableLeafKeys`
          // applies its own empty-folder-falls-back-to-its-own-key rule for
          // THIS folder too — calling it directly on `item.items` would miss
          // that substitution and leave a documentation-only folder mapped to
          // `[]`, which renders permanently unchecked and makes its Toggle a
          // no-op (see `importSelectionHelpers.ts`).
          map.set(importNaturalKeyForFolder(childPath), collectSelectableLeafKeys([item], path))
          walk(item.items, childPath)
        }
      }
    }
    walk(items, [])
    return map
  }, [items])

  const handleLeafToggle = useCallback(
    (leafKey: string, nextChecked: boolean) => {
      // Locked leaves are read-only; the Toggle's `disabled` prop
      // already swallows the click, but guard here anyway in case the
      // event bubbles through (older versions of the Toggle ignored
      // `disabled` on programmatic onChange).
      if (lockedKeys?.has(leafKey)) return
      const next = new Set(selection)
      if (nextChecked) next.add(leafKey)
      else next.delete(leafKey)
      onSelectionChange(next)
    },
    [selection, onSelectionChange, lockedKeys]
  )

  const handleFolderToggle = useCallback(
    (folderKey: string, nextChecked: boolean) => {
      const leafKeys = leafKeysByFolderKey.get(folderKey) ?? []
      onSelectionChange(setFolderSelection(leafKeys, selection, nextChecked, lockedKeys))
    },
    [leafKeysByFolderKey, selection, onSelectionChange, lockedKeys]
  )

  const listItems = useMemo(() => {
    // Inline recursion lets us avoid a `useCallback` that references
    // itself (which the linter rightly flags as a use-before-declare
    // hazard). The renderer is purely derived from `visibleItems +
    // selection`, so it's safe to rebuild on each dependency change.
    const build = (subtree: readonly FolderItem[], path: readonly string[]): ListViewItemData[] => {
      // Import trees only ever carry folders + requests; scenarios,
      // designs and recording sessions are never produced by a spec
      // import, so filter them out defensively.
      return subtree.filter((item): item is Exclude<FolderItem, Scenario | ApiDesign | RecordingSession> => !isScenario(item) && !isApiDesign(item) && !isRecordingSession(item)).map((item) => {
        if (isAnyFolder(item)) {
          const childPath = [...path, item.name]
          const folderKey = importNaturalKeyForFolder(childPath)
          const leafKeys = leafKeysByFolderKey.get(folderKey) ?? []
          const state = folderStateFromSelection(leafKeys, selection)
          const baseTestId = dataTestId ? `${dataTestId}-row-${folderKey.replace(/[^a-zA-Z0-9]/g, '_')}` : undefined
          return {
            id: folderKey,
            title: item.name,
            icon: 'folder',
            isExpanded: true,
            leftActions: (
              <Toggle
                checked={state === 'indeterminate' ? 'indeterminate' : state === 'checked'}
                notFocusable
                onChange={(nextChecked) => { handleFolderToggle(folderKey, nextChecked) }}
                {...(baseTestId && { 'data-testid': `${baseTestId}-toggle` })}
              />
            ),
            children: build(item.items, childPath)
          }
        }
        const leafKey = importNaturalKeyForRequest(item)
        const isLocked = lockedKeys?.has(leafKey) ?? false
        const checked = isLocked || selection.has(leafKey)
        const requestType = item.type
        const requestMethod = requestType === 'http' || requestType === 'auth' ? item.method : requestType
        const badgeType = mapToBadgeType(requestMethod)
        const baseTestId = dataTestId ? `${dataTestId}-row-${leafKey.replace(/[^a-zA-Z0-9]/g, '_')}` : undefined
        const status = leafStatusByKey?.get(leafKey)
        return {
          id: leafKey,
          title: item.name,
          icon: <Badge type={badgeType} />,
          leftActions: (
            <Toggle
              checked={checked}
              disabled={isLocked}
              notFocusable
              onChange={(nextChecked) => { handleLeafToggle(leafKey, nextChecked) }}
              {...(baseTestId && { 'data-testid': `${baseTestId}-toggle` })}
            />
          ),
          ...(status !== undefined ? { rightActions: leafStatusPill(status, baseTestId ? `${baseTestId}-status` : undefined) } : {})
        }
      })
    }
    return build(visibleItems, [])
  }, [dataTestId, handleFolderToggle, handleLeafToggle, leafKeysByFolderKey, leafStatusByKey, lockedKeys, selection, visibleItems])

  return (
    <ListView
      items={listItems}
      ariaLabel="Import selection"
      onItemClick={() => { /* handled by Toggle */ }}
      onItemContextMenu={() => { /* selection tree is read-only here */ }}
      {...(dataTestId && { 'data-testid': dataTestId })}
      // The import modal wraps the tree in a drop zone that takes
      // a paste-like dropped spec; a row drag that crosses into the
      // drop zone would otherwise activate it and replace the
      // preview with the row's serialised payload. The tree itself
      // is purely a selection surface — no row-level reorder
      // makes sense here — so we disable drag on every row.
      disableDrag
    />
  )
}

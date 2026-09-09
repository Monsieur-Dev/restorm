/**
 * Hook for managing workbench tab creation, restoration, and tree updates
 */

import { useCallback, useRef } from 'react'
import {
  isContainerNode,
  isTabGroupNode,
  insertTabAt,
  normalizeTree,
  removeTab,
  findGroup,
  logger
} from 'electron-core-ui/renderer'
import type { WorkbenchTree, GroupNode, EditorTab, SplitDirection } from 'electron-core-ui/renderer'
import type { RestormWorkbenchHandle } from '../components/MainView/Workbench/RestormWorkbench'
import {
  findFirstTabGroupId,
  hasGroupWithId,
  findGroupIdForTab,
  updateGroupById
} from '../utils/workbenchHelpers'
import {
  findFolderById,
  findEnvironmentFolderById,
  findRequestById,
  findItemById,
  findItemWithBreadcrumbs,
  getNearestEnvironmentsForBreadcrumbs
} from '../utils/treeSearch'
import { computeChecksumSnapshot } from '../utils/computeChecksumSnapshot'
import type {
  Folder,
  FolderItem,
  EnvironmentFolder,
  Environment,
  Request,
  Scenario,
  ApiDesign
} from '../../../shared/types/collections'
import {
  isRequest,
  isEnvironmentFolder,
  isAnyFolder,
  isScenario,
  isApiDesign
} from '../../../shared/types/collections'
import { protocolSpec, requestTabTitle, isRequestType } from '../../../shared/protocolRegistry'
import type {
  RestormEditorTab,
  FolderTab,
  EnvironmentFolderTab,
  ScenarioEditorTab,
  DesignTab,
  ConsoleTab,
  FirewallTab,
  SettingsTab,
  McpLogsTab,
  BreadcrumbItem
} from '../../../shared/types/editor'
import { CONSOLE_TAB_ID, FIREWALL_TAB_ID, MINI_BROWSER_TAB_ID, SETTINGS_TAB_ID, MCP_LOGS_TAB_ID, COOKIE_JAR_TAB_ID, type MiniBrowserTab, type CookieJarTab } from '../../../shared/types/editor'

export interface UseWorkbenchTabsOptions {
  rootItems: FolderItem[]
  focusedGroupId: string | null
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  registerTabDirtyState: (id: string, checksum: string) => void
  /** Move workbench focus to a group. Called when a foreground open lands a tab
   * in a group OTHER than the focused one (e.g. activating an already-open tab
   * in a side-by-side split) so the destination pane actually gets selected. */
  focusGroup?: (groupId: string) => void
}

/** Control whether opening a tab moves focus to it. Middle-click ("open in
 * background") flows pass `focus: false` so the current tab + sidebar
 * selection stay put. */
export interface OpenTabOptions {
  focus?: boolean
  /**
   * Open the tab as a preview ("temporary") tab — italic label, one per
   * group. Opening another temporary tab in the same group replaces this
   * one. `true` opens/keeps temporary; `false` explicitly PROMOTES an
   * already-open tab to permanent (a double-click). `undefined` leaves an
   * already-open tab's permanence untouched and opens a NEW tab permanent.
   */
  temporary?: boolean
  /**
   * Open the tab at an explicit position in the tree rather than the
   * default focused/first group. Used by the sidebar→workbench split
   * drop: the user released the dragged item over `targetGroupId`'s
   * `zone` ('left'|'right'|'top'|'bottom' split, or 'full' = stack as a
   * normal tab in that group). When set, the focused-group append /
   * background-vs-foreground bookkeeping is bypassed in favour of ECUI's
   * `insertTabAt`. Ignored when the target group no longer exists.
   */
  placement?: { targetGroupId: string; zone: SplitDirection }
}

/** Find the group + tab id of an open tab whose underlying item id matches.
 * A tab's item id is its `folder.id` or `request.id`. Pure (no React) so it
 * can be unit-tested and reused by {@link placeTabAtPosition}. */
function findOpenTabByItemId(nodes: GroupNode[], itemId: string): { groupId: string; tabId: string } | null {
  for (const node of nodes) {
    if (isContainerNode(node)) {
      const inner = findOpenTabByItemId(node.groups, itemId)
      if (inner !== null) return inner
      continue
    }
    for (const tab of node.tabs) {
      const t = tab as { folder?: { id?: string }; request?: { id?: string }; scenario?: { id?: string }; design?: { id?: string } }
      const tabItemId = t.folder?.id ?? t.request?.id ?? t.scenario?.id ?? t.design?.id
      if (typeof tabItemId === 'string' && tabItemId === itemId) {
        return { groupId: node.id, tabId: tab.id }
      }
    }
  }
  return null
}

/**
 * Place a tab at an explicit group + split zone — the sidebar→workbench
 * split drop. If the same item is already open (by tab id, or by its
 * underlying item id when the index-path tab id changed), the stale copy
 * is removed first so the tree never holds two tabs with the same id
 * (which breaks the workbench's id-keyed slot reconciliation) — the net
 * effect matches dragging the open tab into the new split. When the target
 * group no longer exists (e.g. removing the stale tab emptied + collapsed
 * it), the tab is appended to the first available group instead.
 *
 * Returns the new (normalized) tree and the group the tab landed in (for
 * focus). Pure — all tree ops come from ECUI; no React, so unit-testable.
 */
export function placeTabAtPosition(
  prev: WorkbenchTree,
  tabId: string,
  newTab: EditorTab,
  placement: { targetGroupId: string; zone: SplitDirection },
  itemId?: string
): { tree: WorkbenchTree; landedGroupId: string } {
  const { targetGroupId, zone } = placement
  // Locate any already-open copy of this item (by tab id, then by the
  // underlying item id when the index-path tab id changed).
  let openGroupId = findGroupIdForTab(prev.groups, tabId)
  let openTabId = tabId
  if (!openGroupId && typeof itemId === 'string' && itemId.length > 0) {
    const stale = findOpenTabByItemId(prev.groups, itemId)
    if (stale !== null) { openGroupId = stale.groupId; openTabId = stale.tabId }
  }

  // No-op self-drop: the item is already the SOLE tab of the target group.
  // Splitting a single-tab group against itself would just recreate the same
  // layout — so leave the tree untouched (mirrors the editor-tab self-drop
  // block in EditorGroupView). The center/'full' zone is likewise a no-op
  // here (the tab already lives in, and is active in, this group).
  if (openGroupId === targetGroupId) {
    const loc = findGroup(prev, targetGroupId)
    if (loc.node && isTabGroupNode(loc.node) && loc.node.tabs.length === 1) {
      return { tree: prev, landedGroupId: targetGroupId }
    }
  }

  const base = openGroupId ? removeTab(prev, openGroupId, openTabId).tree : prev
  // `insertTabAt` runs against `base` BEFORE normalization, so re-check the
  // target on `base`; fall back to a plain append when removing the stale
  // copy emptied + collapsed it.
  if (!hasGroupWithId(base.groups, targetGroupId)) {
    const fallbackGroupId = findFirstTabGroupId(base.groups) ?? 'restorm-main-group'
    return { tree: normalizeTree(insertTabAt(base, fallbackGroupId, 'full', newTab)), landedGroupId: fallbackGroupId }
  }
  return { tree: normalizeTree(insertTabAt(base, targetGroupId, zone, newTab)), landedGroupId: targetGroupId }
}

export interface UseWorkbenchTabsReturn {
  workbenchRef: React.RefObject<RestormWorkbenchHandle | null>
  hasRestoredWorkbenchRef: React.RefObject<boolean>
  findIndexPathById: (items: FolderItem[], targetId: string) => number[] | null
  buildTabId: (prefix: 'folder' | 'env-folder' | 'request' | 'scenario' | 'design', id: string) => string
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openScenarioEditorTab: (scenario: Scenario, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openDesignTab: (design: ApiDesign, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => void
  /** Promote the preview tab for `itemId` to a permanent tab (clears the
   * temporary flag). No-op when no matching temporary tab is open. */
  promoteTemporaryTab: (itemId: string) => void
  handleRebuildTab: (tabId: string) => EditorTab | null
  handleStateRestored: (restoredTree: WorkbenchTree | null) => void
  handleSizesChange: (nodeId: string, sizes: number[]) => void
  handleTreeChange: (newTree: WorkbenchTree) => void
}

export function useWorkbenchTabs(options: UseWorkbenchTabsOptions): UseWorkbenchTabsReturn {
  const {
    rootItems,
    focusedGroupId,
    setWorkbenchTree,
    registerTabDirtyState,
    focusGroup
  } = options

  const workbenchRef = useRef<RestormWorkbenchHandle>(null)
  const hasRestoredWorkbenchRef = useRef(false)

  const findIndexPathById = useCallback(function findIndexPathByIdInner(
    items: FolderItem[],
    targetId: string
  ): number[] | null {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item) continue
      if (item.id === targetId) {
        return [i]
      }
      if (isAnyFolder(item)) {
        const childPath = findIndexPathByIdInner(item.items, targetId)
        if (childPath) {
          return [i, ...childPath]
        }
      }
    }
    return null
  }, [])

  /**
   * Walk the workbench tree (recursing into ContainerGroupNodes for
   * split layouts) for the first tab whose underlying tree item id
   * matches `itemId`. Returns `null` if no tab represents that
   * item. Used as the second dedup key in `addTabToTree`: lets us
   * find a stale tab whose `tabId` is now out-of-date because the
   * user moved the request / folder to a different parent.
   */
  const findTabByItemId = useCallback((nodes: GroupNode[], itemId: string): { groupId: string; tabId: string } | null => {
    for (const node of nodes) {
      if (isContainerNode(node)) {
        const inner = findTabByItemId(node.groups, itemId)
        if (inner !== null) return inner
        continue
      }
      for (const tab of node.tabs) {
        const t = tab as { folder?: { id?: string }; request?: { id?: string }; scenario?: { id?: string }; design?: { id?: string } }
        const tabItemId = t.folder?.id ?? t.request?.id ?? t.scenario?.id ?? t.design?.id
        if (typeof tabItemId === 'string' && tabItemId === itemId) {
          return { groupId: node.id, tabId: tab.id }
        }
      }
    }
    return null
  }, [])

  /**
   * Tab id is keyed off the item's stable uuid, NOT its current
   * index path. Index-path-based ids (`request-idx:0.1.5`) flip
   * to point at a DIFFERENT item the moment the user reorders /
   * moves the tree, because the path stays the same while the
   * underlying item changes — meaning two open tabs would swap
   * identities after a sidebar swap. UUID ids stay glued to the
   * item they were opened for. The legacy `request-idx:N.N.N`
   * form is still recognised by `parseTabId` for backward-
   * compat with already-persisted workbench state; new tabs are
   * always emitted as `request-id:<uuid>`.
   */
  const buildTabId = useCallback((prefix: 'folder' | 'env-folder' | 'request' | 'scenario' | 'design', id: string): string => {
    return `${prefix}-id:${id}`
  }, [])

  // Helper to add a tab to the workbench tree, reusing the focused or
  // first group. When `focus` is false (middle-click "open in
  // background" flow), the tab is added without altering the
  // destination group's `activeTabId`, and an already-open tab
  // becomes a no-op instead of re-activating.
  //
  // `itemId` is the underlying tree-item uuid (request.id /
  // folder.id) that this tab represents. It's used as a SECOND
  // dedup key — `tabId` alone isn't enough because index-path-
  // based ids change every time the user drags the item to a
  // different parent. Without `itemId` matching, dragging a
  // request from `pet/0.1.5` to `pet/0.2.3` and re-clicking it
  // would spawn a duplicate tab (the new `tabId` doesn't match
  // the still-open old `tabId`).
  const addTabToTree = useCallback((
    prev: WorkbenchTree,
    tabId: string,
    newTab: EditorTab,
    options?: OpenTabOptions,
    itemId?: string
  ): WorkbenchTree => {
    const focus = options?.focus ?? true
    // Preview-tab intent (see OpenTabOptions.temporary):
    //  - wantTemporary: this open should land a NEW tab as temporary (and
    //    evict the group's existing temporary tab — one per group).
    //  - promote: this open should clear the temporary flag on an
    //    already-open tab (a double-click / explicit permanent open).
    const wantTemporary = options?.temporary === true
    const promote = options?.temporary === false
    if (wantTemporary) newTab.isTemporary = true
    // No groups yet: create the main group with this tab. We always
    // activate it here — even in background mode, an empty workbench
    // has nothing to preserve, so the new tab becomes the only visible
    // content (the alternative is a blank workbench with a hidden tab
    // in an unreachable group).
    if (prev.groups.length === 0) {
      if (focus && focusGroup) queueMicrotask(() => { focusGroup('restorm-main-group') })
      return {
        ...prev,
        groups: [
          {
            id: 'restorm-main-group',
            tabs: [newTab],
            activeTabId: tabId
          }
        ]
      }
    }

    // Explicit placement (sidebar→workbench split drop). The user picked a
    // target group + zone, so honour it instead of the focused/first group
    // append (delegated to the pure `placeTabAtPosition`). Only when the
    // target group still exists — otherwise fall through to the normal path.
    if (options?.placement && hasGroupWithId(prev.groups, options.placement.targetGroupId)) {
      const { tree: nextTree, landedGroupId } = placeTabAtPosition(prev, tabId, newTab, options.placement, itemId)
      if (focusGroup) queueMicrotask(() => { focusGroup(landedGroupId) })
      return nextTree
    }

    // Dedup pass A — by tabId. Fast path for the common case
    // (item hasn't moved since the previous open).
    const existingGroupId = findGroupIdForTab(prev.groups, tabId)
    if (existingGroupId) {
      // Background open of an already-open tab is a no-op UNLESS we're
      // promoting it (a double-click can land here): still clear the flag.
      if (!focus && !promote) return prev
      // Move focus to the group that owns the tab, so a foreground open SELECTS
      // it even when it already lives in another pane of a side-by-side split.
      if (focus && focusGroup) queueMicrotask(() => { focusGroup(existingGroupId) })
      return {
        ...prev,
        groups: updateGroupById(prev.groups, existingGroupId, (group) => ({
          ...group,
          // Promote to permanent on an explicit permanent open; otherwise
          // leave the tab's existing permanence untouched (never demote an
          // already-open tab back to temporary).
          tabs: promote
            ? group.tabs.map((t) => (t.id === tabId && t.isTemporary ? { ...t, isTemporary: false } : t))
            : group.tabs,
          activeTabId: focus ? tabId : (group.activeTabId ?? tabId)
        }))
      }
    }

    // Dedup pass B — by itemId. Fires when the user dragged the
    // item between parents and the index-path-encoded `tabId`
    // changed. Walk every tab in every group, compare to the
    // tab's underlying `request.id` / `folder.id`. On hit:
    // refresh the tab in place with the new `tabId` + new tab
    // payload (breadcrumbs, environments, etc.) and focus.
    if (typeof itemId === 'string' && itemId.length > 0) {
      const stale = findTabByItemId(prev.groups, itemId)
      if (stale !== null) {
        if (focus && focusGroup) queueMicrotask(() => { focusGroup(stale.groupId) })
        const replacedGroups = updateGroupById(prev.groups, stale.groupId, (group) => {
          const nextActive = focus
            ? tabId
            : (group.activeTabId === stale.tabId ? tabId : (group.activeTabId ?? tabId))
          return {
            ...group,
            // Refreshing an already-open tab (its item moved parents): keep its
            // existing permanence — promote only on an explicit permanent open,
            // and never demote a permanent tab back to temporary.
            tabs: group.tabs.map((t) => (t.id === stale.tabId
              ? { ...newTab, isTemporary: promote ? false : (t.isTemporary === true) }
              : t)),
            activeTabId: nextActive
          }
        })
        return { ...prev, groups: replacedGroups }
      }
    }

    // Otherwise, add the tab to the currently focused group when possible
    const preferredGroupId =
      focusedGroupId && hasGroupWithId(prev.groups, focusedGroupId) ? focusedGroupId : null

    const targetGroupId =
      preferredGroupId && hasGroupWithId(prev.groups, preferredGroupId)
        ? preferredGroupId
        : findFirstTabGroupId(prev.groups) ?? 'restorm-main-group'

    if (focus && focusGroup) queueMicrotask(() => { focusGroup(targetGroupId) })

    const updatedGroups = hasGroupWithId(prev.groups, targetGroupId)
      ? updateGroupById(prev.groups, targetGroupId, (group) => {
          // One preview tab per group: a new temporary tab evicts the
          // group's existing temporary tab (a permanent OR pinned tab is
          // never touched). A permanent open leaves every existing tab in
          // place.
          const kept = wantTemporary
            ? group.tabs.filter((t) => t.isTemporary !== true || t.isPinned === true)
            : group.tabs
          // Background mode: preserve the group's current active tab — but if
          // the eviction just removed it, fall back to the just-added tab so
          // the group never points at a tab that no longer exists.
          const activeSurvives = group.activeTabId !== undefined && kept.some((t) => t.id === group.activeTabId)
          return {
            ...group,
            tabs: [...kept, newTab],
            activeTabId: focus ? tabId : (activeSurvives ? (group.activeTabId ?? tabId) : tabId)
          }
        })
      : [
          ...prev.groups,
          {
            id: targetGroupId,
            tabs: [newTab],
            // A brand-new group must have SOME activeTabId — background
            // mode still uses the just-added tab here, because the
            // alternative is an empty selection.
            activeTabId: tabId
          }
        ]

    return {
      ...prev,
      groups: updatedGroups
    }
  }, [focusedGroupId, findTabByItemId, focusGroup])

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => {
    const tabId = buildTabId('folder', folder.id)

    setTimeout(() => {
      const folderChecksum = computeChecksumSnapshot(folder)
      registerTabDirtyState(folder.id, folderChecksum)
    }, 500)

    setWorkbenchTree((prev) => {
      const newTab: FolderTab = {
        id: tabId,
        tabType: 'folder',
        title: folder.name,
        titleString: folder.name,
        folder,
        breadcrumbs,
        allowFullscreen: true
      }
      return addTabToTree(prev, tabId, newTab, options, folder.id)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open the scenario (dataflow graph) editor in the workbench
  const openScenarioEditorTab = useCallback((scenario: Scenario, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => {
    const tabId = buildTabId('scenario', scenario.id)

    setTimeout(() => {
      const scenarioChecksum = computeChecksumSnapshot(scenario)
      registerTabDirtyState(scenario.id, scenarioChecksum)
    }, 500)

    setWorkbenchTree((prev) => {
      const newTab: ScenarioEditorTab = {
        id: tabId,
        tabType: 'scenario-editor',
        title: scenario.name,
        titleString: scenario.name,
        scenario,
        breadcrumbs,
        allowFullscreen: true
      }
      return addTabToTree(prev, tabId, newTab, options, scenario.id)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open the API design editor in the workbench. Single tab per design:
  // `addTabToTree`'s dedup (by tabId, then by item id) refocuses the
  // existing tab when the design is already open.
  const openDesignTab = useCallback((design: ApiDesign, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => {
    const tabId = buildTabId('design', design.id)

    setTimeout(() => {
      const designChecksum = computeChecksumSnapshot(design)
      registerTabDirtyState(design.id, designChecksum)
    }, 500)

    setWorkbenchTree((prev) => {
      const newTab: DesignTab = {
        id: tabId,
        tabType: 'design',
        title: design.name,
        titleString: design.name,
        design,
        breadcrumbs,
        allowFullscreen: true
      }
      return addTabToTree(prev, tabId, newTab, options, design.id)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open an environment folder tab in the workbench
  const openEnvironmentFolderTab = useCallback((folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => {
    const tabId = buildTabId('env-folder', folder.id)

    // Defer checksum registration: the KV table mutates the folder's
    // variables (adding runtime IDs, normalizing types) on first render.
    // Computing the checksum synchronously would capture the pre-mutation
    // state, creating a baseline that never matches subsequent updates.
    // A short deferral lets the first render cycle settle.
    setTimeout(() => {
      const folderChecksum = computeChecksumSnapshot(folder)
      registerTabDirtyState(folder.id, folderChecksum)
    }, 500)

    setWorkbenchTree((prev) => {
      const newTab: EnvironmentFolderTab = {
        id: tabId,
        tabType: 'environment-folder',
        title: folder.name,
        titleString: folder.name,
        folder,
        breadcrumbs,
        allowFullscreen: true
      }
      return addTabToTree(prev, tabId, newTab, options, folder.id)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open any request type tab in the workbench
  const openAnyRequestTab = useCallback(
    (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => {
    const tabId = buildTabId('request', request.id)

    // Register initial checksum for dirty state tracking
    const requestChecksum = computeChecksumSnapshot(request)
    registerTabDirtyState(request.id, requestChecksum)

    // Tab type + label both come from the protocol registry, so a new
    // protocol declares them once there instead of growing a branch here.
    const title = requestTabTitle(request)
    if (title === null || !isRequestType(request.type)) return // Unknown request type
    const tabType = protocolSpec(request.type).tabType

    setWorkbenchTree((prev) => {
      const newTab = {
        id: tabId,
        tabType,
        title,
        titleString: title,
        request,
        breadcrumbs,
        environments,
        allowFullscreen: true
      }
      return addTabToTree(prev, tabId, newTab, options, request.id)
    })
  },
    [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree]
  )

  // Promote a preview tab to permanent — clears the temporary flag on the
  // (single) tab whose underlying tree item matches `itemId`. Called when a
  // temporary tab's content is edited (it enters the dirty set) or its
  // request is run. A no-op when no matching temporary tab is open.
  const promoteTemporaryTab = useCallback((itemId: string) => {
    if (typeof itemId !== 'string' || itemId.length === 0) return
    setWorkbenchTree((prev) => {
      // Widen to `boolean`: the flag is only mutated inside the nested
      // `clearIn` closure, which TS control-flow can't see from the outer
      // return — without the widening it stays typed `false`.
      let changed = false as boolean
      // Rebuild only the branch that actually changed: untouched groups and
      // arrays keep their identity so unrelated panes don't re-render.
      const clearIn = (nodes: GroupNode[]): GroupNode[] => {
        // Widen to `boolean`: mutated inside the nested `.map` closures below,
        // which TS control-flow can't see from the outer returns.
        let arrChanged = false as boolean
        const out = nodes.map((node) => {
          if (isContainerNode(node)) {
            const groups = clearIn(node.groups)
            if (groups === node.groups) return node
            arrChanged = true
            return { ...node, groups }
          }
          if (!isTabGroupNode(node)) return node
          let nodeChanged = false as boolean
          const tabs = node.tabs.map((tab) => {
            const t = tab as { folder?: { id?: string }; request?: { id?: string }; scenario?: { id?: string }; design?: { id?: string } }
            const tabItemId = t.folder?.id ?? t.request?.id ?? t.scenario?.id ?? t.design?.id
            if (tab.isTemporary === true && tabItemId === itemId) {
              changed = true
              nodeChanged = true
              return { ...tab, isTemporary: false }
            }
            return tab
          })
          if (!nodeChanged) return node
          arrChanged = true
          return { ...node, tabs }
        })
        return arrChanged ? out : nodes
      }
      const nextGroups = clearIn(prev.groups)
      return changed ? { ...prev, groups: nextGroups } : prev
    })
  }, [setWorkbenchTree])

  const parseTabId = useCallback((tabId: string): { type: 'folder' | 'env-folder' | 'request' | 'scenario' | 'design'; itemId: string } | null => {
    const match = /^(folder|env-folder|request|scenario|design)-id:(.+)$/.exec(tabId)
    if (match?.[1] && match[2]) {
      return {
        type: match[1] as 'folder' | 'env-folder' | 'request' | 'scenario' | 'design',
        itemId: match[2]
      }
    }
    return null
  }, [])

  // Rebuild tab callback for workbench autosave
  const handleRebuildTab = useCallback((tabId: string, data?: unknown): EditorTab | null => {
    // Console singleton: not tied to any tree item, so it doesn't go
    // through `parseTabId`. The tab content (xterm + toolbar) is
    // owned by `RestormWorkbench` based on the `tabType: 'console'`
    // discriminator — we just rebuild the metadata shell.
    if (tabId === CONSOLE_TAB_ID) {
      return {
        id: CONSOLE_TAB_ID,
        tabType: 'console',
        title: 'Console',
        titleString: 'Console',
        allowFullscreen: true
      } as ConsoleTab
    }
    // Firewall singleton — same pattern as Console: not tied to
    // any tree item, content owned by `RestormWorkbench`'s
    // `tabType: 'firewall'` branch.
    if (tabId === FIREWALL_TAB_ID) {
      return {
        id: FIREWALL_TAB_ID,
        tabType: 'firewall',
        title: 'Firewall',
        titleString: 'Firewall',
        allowFullscreen: true
      } as FirewallTab
    }
    // Mini browser singleton — same singleton-shell pattern, but it
    // round-trips a navigated URL via ECUI's per-tab `persistedState`
    // (see `extractWorkbenchState` / `RebuildTabCallback`). Without
    // this branch the tab silently dropped on every file reopen.
    if (tabId === MINI_BROWSER_TAB_ID) {
      const url = typeof (data as { url?: unknown } | undefined)?.url === 'string'
        ? (data as { url: string }).url
        : undefined
      return {
        id: MINI_BROWSER_TAB_ID,
        tabType: 'mini-browser',
        title: 'Mini browser',
        titleString: 'Mini browser',
        allowFullscreen: true,
        ...(url !== undefined ? { url, persistedState: { url } } : {})
      } as MiniBrowserTab
    }
    // Settings singleton — same singleton-shell pattern as Console /
    // Firewall: not tied to any tree item, content owned by
    // `RestormWorkbench`'s `tabType: 'settings'` branch.
    if (tabId === SETTINGS_TAB_ID) {
      return {
        id: SETTINGS_TAB_ID,
        tabType: 'settings',
        title: 'Settings',
        titleString: 'Settings',
        allowFullscreen: true
      } as SettingsTab
    }
    // MCP logs singleton — same pattern as Settings: content owned by
    // `RestormWorkbench`'s `tabType: 'mcp-logs'` branch.
    if (tabId === MCP_LOGS_TAB_ID) {
      return {
        id: MCP_LOGS_TAB_ID,
        tabType: 'mcp-logs',
        title: 'MCP logs',
        titleString: 'MCP logs',
        allowFullscreen: true
      } as McpLogsTab
    }
    // Cookie jar singleton — same shell pattern; without this branch the tab
    // silently dropped on every file reopen (the bug the others document).
    if (tabId === COOKIE_JAR_TAB_ID) {
      return {
        id: COOKIE_JAR_TAB_ID,
        tabType: 'cookie-jar',
        title: 'Cookie jar',
        titleString: 'Cookie jar',
        allowFullscreen: true
      } as CookieJarTab
    }
    const parsed = parseTabId(tabId)
    if (!parsed) return null

    if (parsed.type === 'env-folder') {
      {
        const folder = findEnvironmentFolderById(rootItems, parsed.itemId)
        if (folder) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, folder.id)
          return {
            id: tabId,
            tabType: 'environment-folder',
            title: folder.name,
            titleString: folder.name,
            folder,
            breadcrumbs,
            allowFullscreen: true
          } as EnvironmentFolderTab
        }
      }
      return null
    }

    if (parsed.type === 'folder') {
      {
        const folder = findFolderById(rootItems, parsed.itemId)
        if (folder && !isEnvironmentFolder(folder as FolderItem)) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, folder.id)
          return {
            id: tabId,
            tabType: 'folder',
            title: folder.name,
            titleString: folder.name,
            folder,
            breadcrumbs,
            allowFullscreen: true
          } as FolderTab
        }
      }
      return null
    }

    if (parsed.type === 'scenario') {
      const item = findItemById(rootItems, parsed.itemId)
      if (item && isScenario(item)) {
        const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, item.id)
        return {
          id: tabId,
          tabType: 'scenario-editor',
          title: item.name,
          titleString: item.name,
          scenario: item,
          breadcrumbs,
          allowFullscreen: true
        } as ScenarioEditorTab
      }
      return null
    }

    if (parsed.type === 'design') {
      const item = findItemById(rootItems, parsed.itemId)
      if (item && isApiDesign(item)) {
        const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, item.id)
        return {
          id: tabId,
          tabType: 'design',
          title: item.name,
          titleString: item.name,
          design: item,
          breadcrumbs,
          allowFullscreen: true
        } as DesignTab
      }
      return null
    }

    const requestItem: FolderItem | null = findRequestById(rootItems, parsed.itemId) ?? null
    if (requestItem && isRequest(requestItem)) {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, requestItem.id)
      const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)

      // Same registry lookup as the open path — one declaration per
      // protocol, no per-protocol branch to keep in sync here.
      const title = requestTabTitle(requestItem)
      if (title !== null && isRequestType(requestItem.type)) {
        return {
          id: tabId,
          tabType: protocolSpec(requestItem.type).tabType,
          title,
          titleString: title,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as RestormEditorTab
      }
    }
    return null
  }, [parseTabId, rootItems])

  // Handle workbench state restored
  const handleStateRestored = useCallback((restoredTree: WorkbenchTree | null) => {
    logger.info('[App] workbench state restored', {
      hasTree: Boolean(restoredTree),
      groupCount: restoredTree?.groups.length ?? 0
    })
    if (restoredTree) {
      setWorkbenchTree(restoredTree)
      // Register dirty-state baselines for every restored tab so the
      // dirty-dot tracking works for modify + revert cycles.
      const registerRestoredTabs = (groups: GroupNode[]): void => {
        for (const node of groups) {
          if (isContainerNode(node)) {
            registerRestoredTabs(node.groups)
          } else {
            for (const tab of node.tabs) {
              const typed = tab as { folder?: EnvironmentFolder | Folder; request?: Request; scenario?: Scenario; design?: ApiDesign }
              const doc = typed.folder ?? typed.request ?? typed.scenario ?? typed.design
              if (doc) {
                const checksum = computeChecksumSnapshot(doc)
                registerTabDirtyState(doc.id, checksum)
              }
            }
          }
        }
      }
      registerRestoredTabs(restoredTree.groups)
    }
  }, [setWorkbenchTree, registerTabDirtyState])

  // Handle sizes change from workbench sash dragging
  const handleSizesChange = useCallback((nodeId: string, sizes: number[]) => {
    setWorkbenchTree(prev => {
      if (nodeId === 'root') {
        return { ...prev, sizes }
      }

      // Recursively update sizes for nested container nodes
      const updateNodeSizes = (nodes: GroupNode[]): GroupNode[] => {
        return nodes.map(node => {
          if (isContainerNode(node)) {
            if (node.id === nodeId) {
              return { ...node, sizes }
            }
            return { ...node, groups: updateNodeSizes(node.groups) }
          }
          return node
        })
      }

      return { ...prev, groups: updateNodeSizes(prev.groups) }
    })
  }, [setWorkbenchTree])

  const handleTreeChange = useCallback((newTree: WorkbenchTree) => {
    setWorkbenchTree(newTree)
  }, [setWorkbenchTree])

  return {
    workbenchRef,
    hasRestoredWorkbenchRef,
    findIndexPathById,
    buildTabId,
    openFolderTab,
    openScenarioEditorTab,
    openDesignTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    promoteTemporaryTab,
    handleRebuildTab,
    handleStateRestored,
    handleSizesChange,
    handleTreeChange
  }
}

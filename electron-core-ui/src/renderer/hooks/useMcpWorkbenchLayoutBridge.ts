/**
 * Bridge the MCP `get_workbench_layout` / `set_workbench_layout` tools
 * into the renderer's live workbench tree.
 *
 * The workbench is an electron-core-ui concern, so the generic get/set
 * ORCHESTRATION lives here, not in any host app:
 *
 *  - READ: the renderer owns the live `WorkbenchTree` (groups, splits,
 *    sashes, tabs) + the focused group + the maximized tab, none of which
 *    the main process can read synchronously. So this hook serializes them
 *    to the flat, JSON-safe `WorkbenchLayout` (`serializeWorkbenchLayout`)
 *    and PUSHES it to main on every change via the injected bridge; main
 *    caches it and `get_workbench_layout` reads the cache.
 *
 *  - WRITE: main broadcasts the requested layout spec; this hook rebuilds
 *    it into a live tree via `applyWorkbenchLayout` — reconstructing /
 *    opening each tab through the host's `rebuildTab` — then swaps the
 *    tree, focus, and maximized state in, and re-activates the focused
 *    group's active tab so the host's selection / active-state caches stay
 *    in sync (the same side-effect a click / tab-switcher activation has).
 *
 * The hook is host-agnostic: it never reaches for a specific `window.*`
 * namespace. The host injects the IPC `bridge`, a `serializeTab` /
 * `rebuildTab` pair (the app-specific mapping between an `EditorTab` and
 * its flat descriptor — tab types, tree-item ids, singleton ids), and the
 * tree / focus / maximized setters. Disabled (no listeners / no push)
 * when `enabled` is false or the bridge is absent, so the common non-MCP
 * path pays nothing.
 */

import { useEffect } from 'react'
import {
  serializeWorkbenchLayout,
  applyWorkbenchLayout,
  type TabSerializer,
  type TabRebuilder,
  type WorkbenchLayout
} from '../components/Workbench/layout'
import { findGroup } from '../components/Workbench/tree'
import { isTabGroupNode } from '../components/Workbench/types'
import type { WorkbenchTree } from '../components/Workbench/types'

/**
 * IPC bridge the host injects. Mirrors the two MCP workbench-layout
 * channels:
 * - `pushWorkbenchLayout` → renderer-to-main push of the serialized layout
 *   (cached by `get_workbench_layout`).
 * - `onMcpSetWorkbenchLayout` ← main-to-renderer broadcast of a layout
 *   spec to apply (from `set_workbench_layout`).
 */
export interface WorkbenchLayoutBridgeApi {
  pushWorkbenchLayout: (layout: WorkbenchLayout) => void
  onMcpSetWorkbenchLayout: (cb: (layout: WorkbenchLayout) => void) => () => void
}

export interface UseMcpWorkbenchLayoutBridgeInput {
  enabled: boolean
  /**
   * IPC bridge object. When `null` / `undefined` (e.g. the host hasn't
   * wired its preload yet, or runs in a non-Electron context) the hook
   * no-ops cleanly.
   */
  bridge: WorkbenchLayoutBridgeApi | null | undefined
  /** Current live workbench tree (for the read-side push). */
  tree: WorkbenchTree
  /** Currently focused group id (for the read-side push). */
  focusedGroupId: string | null
  /**
   * Id of the maximized (fullscreen) tab, or null (for the read-side
   * push). Passed in reactively so the snapshot refreshes on maximize /
   * restore — it lives outside the tree.
   */
  maximizedTabId: string | null
  /**
   * Host mapping from a live `EditorTab` to its flat descriptor
   * (`tabType` / `title` / `itemId` / optional `data`). App-specific:
   * only the host knows what backs each tab.
   */
  serializeTab: TabSerializer
  /**
   * Host mapping from a flat `LayoutTab` back to a live `EditorTab`
   * (opening / reconstructing whatever it backs). Return `null` to drop a
   * tab that can't be reconstructed — the apply prunes it and any group it
   * would have emptied.
   */
  rebuildTab: TabRebuilder
  /** Swap the whole tree in (set-side). */
  setWorkbenchTree: (tree: WorkbenchTree) => void
  /** Move focus to a group (set-side). */
  setFocusedGroupId: (groupId: string | null) => void
  /**
   * Apply the maximized (fullscreen) tab (set-side). Called only when the
   * incoming spec asked for one — `get` always reports the maximized tab,
   * `set` honours it only if specified.
   */
  setMaximizedTabId: (tabId: string | null) => void
  /**
   * Notify that a tab became active (set-side) — keeps the host's sidebar
   * selection + active-state caches in sync after a layout swap, the same
   * way a click / tab-switcher activation does.
   */
  onTabActivate: (tabId: string) => void
}

export function useMcpWorkbenchLayoutBridge(input: UseMcpWorkbenchLayoutBridgeInput): void {
  const {
    enabled,
    bridge,
    tree,
    focusedGroupId,
    maximizedTabId,
    serializeTab,
    rebuildTab,
    setWorkbenchTree,
    setFocusedGroupId,
    setMaximizedTabId,
    onTabActivate
  } = input

  // READ side — push the serialized layout whenever the tree / focus /
  // maximized state changes. All three are passed in reactively, so the
  // cached snapshot main reads is always fresh.
  useEffect(() => {
    if (!enabled || !bridge) return
    const layout = serializeWorkbenchLayout(tree, serializeTab, { focusedGroupId, maximizedTabId })
    bridge.pushWorkbenchLayout(layout)
  }, [enabled, bridge, tree, focusedGroupId, maximizedTabId, serializeTab])

  // WRITE side — apply an incoming layout spec.
  useEffect(() => {
    if (!enabled || !bridge) return
    const off = bridge.onMcpSetWorkbenchLayout((layout) => {
      const applied = applyWorkbenchLayout(layout, rebuildTab)
      setWorkbenchTree(applied.tree)
      if (applied.focusedGroupId !== undefined) setFocusedGroupId(applied.focusedGroupId)
      // Apply the maximized tab only when the spec asked for one (get
      // always reports it; set honours it only if specified).
      if (applied.maximizedTabId !== undefined) setMaximizedTabId(applied.maximizedTabId)
      // Sync the active-tab side-effects (sidebar selection + active-state
      // caches) for the focused group's active tab, the same way a click /
      // tab-switcher activation does — otherwise a follow-up read would be
      // stale.
      const focusGroupId = applied.focusedGroupId ?? applied.tree.groups[0]?.id ?? null
      const focusNode = focusGroupId ? findGroup(applied.tree, focusGroupId).node : null
      const activeTabId = focusNode && isTabGroupNode(focusNode) ? focusNode.activeTabId : undefined
      if (activeTabId) onTabActivate(activeTabId)
    })
    return () => { off() }
  }, [enabled, bridge, rebuildTab, setWorkbenchTree, setFocusedGroupId, setMaximizedTabId, onTabActivate])
}

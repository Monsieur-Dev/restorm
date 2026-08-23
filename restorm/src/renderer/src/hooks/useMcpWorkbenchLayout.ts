/**
 * Wire restorm's MCP `get_workbench_layout` / `set_workbench_layout` tools
 * to the generic electron-core-ui workbench-layout bridge
 * (`useMcpWorkbenchLayoutBridge`).
 *
 * The bridge owns the generic orchestration (serialize + push for reads,
 * apply + swap tree / focus / maximized / active-tab for writes). This
 * module supplies only the restorm-specific pieces:
 *
 *  - `serializeTab`: map a `RestormEditorTab` to its flat descriptor
 *    (tab type, tree-item id, opt-in per-tab `data`),
 *  - `rebuildTab` / `resolveRebuildTabId`: map a flat `LayoutTab` back to
 *    the `tabId` `handleRebuildTab` understands (singleton specials by
 *    `tabType`, tree-backed tabs by the legacy `<type>-id:<itemId>` form),
 *  - the `window.restorm.runtime` IPC bridge slice.
 */

import { useMemo } from 'react'
import {
  useMcpWorkbenchLayoutBridge,
  type WorkbenchLayout,
  type LayoutTab,
  type EditorTab,
  type TabSerializer,
  type TabRebuilder,
  type WorkbenchTree,
  type RebuildTabCallback
} from 'electron-core-ui/renderer'
import type { RestormEditorTab } from '../../../shared/types/editor'
import {
  CONSOLE_TAB_ID,
  MCP_LOGS_TAB_ID,
  COOKIE_JAR_TAB_ID,
  FIREWALL_TAB_ID,
  MINI_BROWSER_TAB_ID,
  SETTINGS_TAB_ID
} from '../../../shared/types/editor'

interface RestormLayoutBridge {
  pushWorkbenchLayout: (layout: WorkbenchLayout) => void
  onMcpSetWorkbenchLayout: (cb: (layout: WorkbenchLayout) => void) => () => void
}

/**
 * Map a restorm tab to its tree-item id (request / folder / env-folder /
 * scenario id) for the layout snapshot, or `null` for the singleton
 * special tabs, which carry no underlying tree item and are re-opened by
 * `tabType` instead.
 */
function tabItemId(tab: RestormEditorTab): string | null {
  if ('request' in tab) return tab.request.id
  if ('scenario' in tab) return tab.scenario.id
  if ('folder' in tab) return tab.folder.id
  return null
}

/** The singleton special tab types, keyed to their stable ids. Must cover
 * every singleton `handleRebuildTab` can rebuild: a tab type missing here has
 * no `itemId` to fall back on, so `resolveRebuildTabId` returns null and the
 * tab is dropped from the reconstructed layout without a word — taking its
 * group with it when it was the only tab in one. Extend this map (one line)
 * when a new singleton tab is added.
 */
const SPECIAL_TAB_IDS: Record<string, string> = {
  console: CONSOLE_TAB_ID,
  firewall: FIREWALL_TAB_ID,
  'mini-browser': MINI_BROWSER_TAB_ID,
  settings: SETTINGS_TAB_ID,
  'mcp-logs': MCP_LOGS_TAB_ID,
  'cookie-jar': COOKIE_JAR_TAB_ID
}

/** Map a request `tabType` to the tab-id prefix `parseTabId` understands. */
const REQUEST_TAB_TYPES = new Set([
  'http-request',
  'graphql-request',
  'grpc-request',
  'soap-request',
  'websocket-request',
  'sse-request',
  'stomp-request',
  'odata-request',
  'auth-request',
  'jsonrpc-request',
  'jsonrpc-batch-request',
  'trpc-request',
  'amqp-request',
  'redis-request',
  'kafka-request'
])

/**
 * Resolve the tabId that `handleRebuildTab` expects for a layout tab.
 * Singleton specials → their stable id (by `tabType`). Tree-backed tabs
 * → the legacy `<type>-id:<itemId>` form, which `parseTabId` resolves
 * against the live `rootItems`. Returns `null` when neither applies.
 *
 * Exported for unit testing the tab-type → tabId mapping.
 */
export function resolveRebuildTabId(layoutTab: LayoutTab): string | null {
  const tabType = layoutTab.tabType
  if (tabType && SPECIAL_TAB_IDS[tabType]) return SPECIAL_TAB_IDS[tabType]
  const itemId = layoutTab.itemId
  if (typeof itemId !== 'string' || itemId.length === 0) return null
  if (tabType === 'folder') return `folder-id:${itemId}`
  if (tabType === 'environment-folder') return `env-folder-id:${itemId}`
  if (tabType === 'scenario-editor') return `scenario-id:${itemId}`
  if (tabType && REQUEST_TAB_TYPES.has(tabType)) return `request-id:${itemId}`
  return null
}

export interface UseMcpWorkbenchLayoutInput {
  enabled: boolean
  /** Current live workbench tree (for the read-side push). */
  tree: WorkbenchTree
  /** Currently focused group id (for the read-side push). */
  focusedGroupId: string | null
  /** Id of the maximized (fullscreen) tab, or null (for the read-side
   * push). Passed in reactively so the snapshot refreshes on maximize /
   * restore — it lives outside the tree. */
  maximizedTabId: string | null
  /** Swap the whole tree in (set-side). */
  setWorkbenchTree: (tree: WorkbenchTree) => void
  /** Move focus to a group (set-side). */
  setFocusedGroupId: (groupId: string | null) => void
  /** Apply the maximized (fullscreen) tab (set-side) — drives the
   * workbench's `setFullscreenTabId` handle. */
  setMaximizedTabId: (tabId: string | null) => void
  /** Reconstruct a tab from its id — the autosave restore callback. */
  handleRebuildTab: RebuildTabCallback
  /** Notify that a tab became active (set-side) — keeps the sidebar
   * selection + the `get_current_tab` active-state cache in sync after a
   * layout swap, the same way a click / tab-switcher activation does. */
  onTabActivate: (tabId: string) => void
}

export function useMcpWorkbenchLayout(input: UseMcpWorkbenchLayoutInput): void {
  const {
    enabled,
    tree,
    focusedGroupId,
    maximizedTabId,
    setWorkbenchTree,
    setFocusedGroupId,
    setMaximizedTabId,
    handleRebuildTab,
    onTabActivate
  } = input

  const bridge = useMemo(
    () => (window as { restorm?: { runtime?: RestormLayoutBridge } }).restorm?.runtime ?? null,
    []
  )

  const serializeTab = useMemo<TabSerializer>(
    () => (tab: EditorTab) => {
      const rt = tab as RestormEditorTab
      // Only round-trip per-tab `data` for tabs that opt in (the
      // mini-browser url). Other tabs' `persistedState` is autosave-shaped
      // and shouldn't leak through the MCP layout snapshot, and
      // `handleRebuildTab` ignores `data` for them on the way back.
      const data = rt.tabType === 'mini-browser' ? rt.persistedState : undefined
      return {
        tabType: rt.tabType,
        title: rt.titleString ?? (typeof rt.title === 'string' ? rt.title : ''),
        itemId: tabItemId(rt),
        data
      }
    },
    []
  )

  const rebuildTab = useMemo<TabRebuilder>(
    () => (layoutTab: LayoutTab): EditorTab | null => {
      const rebuildId = resolveRebuildTabId(layoutTab)
      if (!rebuildId) return null
      // The mini-browser singleton round-trips its url via persistedState;
      // `handleRebuildTab` reads it from the `data` argument.
      return handleRebuildTab(rebuildId, layoutTab.data)
    },
    [handleRebuildTab]
  )

  useMcpWorkbenchLayoutBridge({
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
  })
}

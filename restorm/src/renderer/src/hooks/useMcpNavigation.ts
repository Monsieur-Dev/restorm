/**
 * Bridge MCP navigation IPC events into the workbench. The main
 * process broadcasts `mcp:open-tab` / `mcp:reveal-in-tree` whenever an
 * MCP client invokes the matching tool; this hook listens for those,
 * resolves the item against the live `rootItems`, and routes to the
 * existing tab-opening / sidebar-expansion paths.
 *
 * Disabled outside MCP mode — when `mcpEnabled` is false the listeners
 * are never registered, so the renderer pays no cost in the common
 * non-MCP case.
 *
 * `reveal_in_tree` only expands the ancestors today (selecting +
 * scrolling to the node would require a sidebar-side ref / scroll API
 * that doesn't exist yet — tracked as a known limitation in the MCP
 * doc; expansion alone already covers "make this node visible").
 */

import { useEffect } from 'react'
import type { FolderItem, Folder, EnvironmentFolder, Request, Environment } from '../../../shared/types/collections'
import { findFolderById, findEnvironmentFolderById, findRequestById, findItemWithBreadcrumbs, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import type { BreadcrumbItem } from '../../../shared/types/editor'
import type { OpenTabOptions } from './useWorkbenchTabs'

type ActiveKind = 'request' | 'folder' | 'env-folder'

interface RestormNavBridge {
  onMcpOpenTab: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
  onMcpRevealInTree: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
}

export interface UseMcpNavigationInput {
  enabled: boolean
  rootItems: FolderItem[]
  setExpandedIds: (updater: (prev: string[]) => string[]) => void
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => void
}

export function useMcpNavigation(input: UseMcpNavigationInput): void {
  const { enabled, rootItems, setExpandedIds, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormNavBridge } }
    const api = root.restorm?.runtime
    if (!api) return

    const offOpen = api.onMcpOpenTab(({ itemId, kind }) => {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      if (kind === 'request') {
        const req = findRequestById(rootItems, itemId)
        if (!req) return
        const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
        openAnyRequestTab(req, breadcrumbs, envs)
      } else if (kind === 'env-folder') {
        const f = findEnvironmentFolderById(rootItems, itemId)
        if (!f) return
        openEnvironmentFolderTab(f, breadcrumbs)
      } else {
        // kind === 'folder' (only remaining union arm — ActiveKind is exhaustive).
        const f = findFolderById(rootItems, itemId)
        if (!f) return
        openFolderTab(f, breadcrumbs)
      }
    })

    const offReveal = api.onMcpRevealInTree(({ itemId }) => {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      const ancestorIds = breadcrumbs.map((b) => b.id).filter((id) => id !== itemId)
      if (ancestorIds.length === 0) return
      setExpandedIds((prev) => Array.from(new Set([...prev, ...ancestorIds])))
    })

    return () => {
      offOpen()
      offReveal()
    }
  }, [enabled, rootItems, setExpandedIds, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab])
}

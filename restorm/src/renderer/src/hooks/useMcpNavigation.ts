/**
 * Bridge MCP navigation IPC events into the workbench. The main
 * process broadcasts `mcp:open-tab` / `mcp:reveal-in-tree` whenever an
 * MCP client invokes the matching tool; this hook listens for those,
 * resolves the item against the live `rootItems`, and routes through
 * the *same* navigation side-effects a sidebar click would trigger —
 * sidebar selection, ancestor expansion, MRU/alt-tab history, plus
 * the tab open. Anything less and the workbench tab opens but the
 * user can't tell where the AI is in the project.
 *
 * Disabled outside MCP mode — when `mcpEnabled` is false the listeners
 * are never registered, so the renderer pays no cost in the common
 * non-MCP case.
 */

import { useEffect } from 'react'
import { navigationService } from 'electron-core-ui/renderer'
import type { FolderItem, Folder, EnvironmentFolder, Request, Environment, Scenario } from '../../../shared/types/collections'
import { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isODataRequest, isTrpcRequest, isAmqpRequest, isRedisRequest } from '../../../shared/types/collections'
import { findFolderById, findEnvironmentFolderById, findRequestById, findScenarioById, findItemWithBreadcrumbs, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import type { BreadcrumbItem } from '../../../shared/types/editor'
import type { OpenTabOptions } from './useWorkbenchTabs'

type ActiveKind = 'request' | 'folder' | 'env-folder' | 'scenario'

interface RestormNavBridge {
  onMcpOpenTab: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
  onMcpRevealInTree: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
  onMcpCloseTab: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
}

export interface UseMcpNavigationInput {
  enabled: boolean
  rootItems: FolderItem[]
  setExpandedIds: (updater: (prev: string[]) => string[]) => void
  setSelectedItemId: (next: string | null) => void
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => void
  openScenarioEditorTab: (scenario: Scenario, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  closeTabByItemId: (itemId: string) => void
}

/**
 * Map a typed `Request` instance to the `navigationService` type tag
 * used by every other navigation source (sidebar / breadcrumb). Keeps
 * the alt-tab / MRU list shape consistent regardless of who opened
 * the tab.
 */
function navTypeForRequest(req: Request): string {
  if (isHTTPRequest(req)) return 'http-request'
  if (isGraphQLRequest(req)) return 'graphql-request'
  if (isGrpcRequest(req)) return 'grpc-request'
  if (isSoapRequest(req)) return 'soap-request'
  if (isWebSocketRequest(req)) return 'websocket-request'
  if (isSseRequest(req)) return 'sse-request'
  if (isODataRequest(req)) return 'odata-request'
  if (isTrpcRequest(req)) return 'trpc-request'
  if (isAmqpRequest(req)) return 'amqp-request'
  if (isRedisRequest(req)) return 'redis-request'
  return 'http-request'
}

export function useMcpNavigation(input: UseMcpNavigationInput): void {
  const {
    enabled,
    rootItems,
    setExpandedIds,
    setSelectedItemId,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    openScenarioEditorTab,
    closeTabByItemId
  } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormNavBridge } }
    const api = root.restorm?.runtime
    if (!api) return

    /**
     * Expand the breadcrumb ancestors of `itemId` so the node is
     * visible after we select it. Same logic the `mcp:reveal-in-tree`
     * listener uses, lifted to a helper so the open-tab path can fire
     * it too — a select without expansion is invisible if the parent
     * folder happens to be collapsed.
     */
    const expandAncestors = (itemId: string): void => {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      const ancestorIds = breadcrumbs.map((b) => b.id).filter((id) => id !== itemId)
      if (ancestorIds.length === 0) return
      setExpandedIds((prev) => Array.from(new Set([...prev, ...ancestorIds])))
    }

    const offOpen = api.onMcpOpenTab(({ itemId, kind }) => {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      if (kind === 'request') {
        const req = findRequestById(rootItems, itemId)
        if (!req) return
        const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
        openAnyRequestTab(req, breadcrumbs, envs)
        setSelectedItemId(itemId)
        expandAncestors(itemId)
        navigationService.navigateTo(itemId, 'mcp', { type: navTypeForRequest(req) })
      } else if (kind === 'env-folder') {
        const f = findEnvironmentFolderById(rootItems, itemId)
        if (!f) return
        openEnvironmentFolderTab(f, breadcrumbs)
        setSelectedItemId(itemId)
        expandAncestors(itemId)
        navigationService.navigateTo(itemId, 'mcp', { type: 'environment-folder' })
      } else if (kind === 'scenario') {
        const s = findScenarioById(rootItems, itemId)
        if (!s) return
        openScenarioEditorTab(s, breadcrumbs)
        setSelectedItemId(itemId)
        expandAncestors(itemId)
        navigationService.navigateTo(itemId, 'mcp', { type: 'scenario-editor' })
      } else {
        // kind === 'folder' (only remaining union arm — ActiveKind is exhaustive).
        const f = findFolderById(rootItems, itemId)
        if (!f) return
        openFolderTab(f, breadcrumbs)
        setSelectedItemId(itemId)
        expandAncestors(itemId)
        navigationService.navigateTo(itemId, 'mcp', { type: 'folder' })
      }
    })

    const offReveal = api.onMcpRevealInTree(({ itemId }) => {
      expandAncestors(itemId)
    })

    const offClose = api.onMcpCloseTab(({ itemId }) => {
      closeTabByItemId(itemId)
    })

    return () => {
      offOpen()
      offReveal()
      offClose()
    }
  }, [enabled, rootItems, setExpandedIds, setSelectedItemId, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, openScenarioEditorTab, closeTabByItemId])
}

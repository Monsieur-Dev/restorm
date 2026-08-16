/**
 * Bridge MCP navigation IPC events into the workbench. The main
 * process broadcasts `mcp:open-tab` / `mcp:reveal-in-tree` whenever an
 * MCP client invokes the matching tool; this hook listens for those,
 * resolves the item against the live tree, and routes through
 * the *same* navigation side-effects a sidebar click would trigger —
 * sidebar selection, ancestor expansion, MRU/alt-tab history, plus
 * the tab open. Anything less and the workbench tab opens but the
 * user can't tell where the AI is in the project.
 *
 * Disabled outside MCP mode — when `mcpEnabled` is false the listeners
 * are never registered, so the renderer pays no cost in the common
 * non-MCP case. `mcpEnabled` only flips once the config read resolves, so
 * during the first instants after launch nothing here is listening and an
 * `open_tab` gets no ack; main retries within its own budget and then
 * reports an explicit error, which is the intended outcome — the window
 * genuinely wasn't ready to show anything yet.
 *
 * Resolves items via `rootItemsRef.current` rather than a `rootItems`
 * state prop, and deliberately does NOT list the tree as an effect
 * dependency. A client that just created the item it's opening can have
 * its `mcp:open-tab` broadcast delivered (Electron IPC is FIFO per
 * `webContents`) before React gets a chance to commit the preceding
 * `mcp:tree-replace`'s `setRootItems` and re-run this effect with a fresh
 * `rootItems` closure — reading the STATE in that window returns the
 * pre-create tree and the item is genuinely not there yet, from this
 * effect's point of view. `rootItemsRef` sidesteps that entirely: it's
 * written synchronously, in the SAME tick, by `useMcpTreeReplace`'s
 * `mcp:tree-replace` handler (see that hook's prop doc), so by the time
 * this handler runs, it always reads the tree as of the most recent IPC
 * message actually processed — never a stale render.
 */

import { useEffect } from 'react'
import { navigationService, logger } from 'electron-core-ui/renderer'
import type { FolderItem, Folder, EnvironmentFolder, Request, Environment, Scenario, ApiDesign } from '../../../shared/types/collections'
import { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isStompRequest, isODataRequest, isJsonRpcRequest, isJsonRpcBatchRequest, isTrpcRequest, isAmqpRequest, isRedisRequest, isKafkaRequest } from '../../../shared/types/collections'
import { findFolderById, findEnvironmentFolderById, findRequestById, findScenarioById, findDesignById, findItemWithBreadcrumbs, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import type { BreadcrumbItem } from '../../../shared/types/editor'
import type { OpenTabOptions } from './useWorkbenchTabs'

type ActiveKind = 'request' | 'folder' | 'env-folder' | 'scenario' | 'design'

interface RestormNavBridge {
  onMcpOpenTab: (cb: (payload: { requestId?: string; itemId: string; kind: ActiveKind }) => void) => () => void
  onMcpRevealInTree: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
  onMcpCloseTab: (cb: (payload: { itemId: string; kind: ActiveKind }) => void) => () => void
  /** Ack an `mcp:open-tab` request back to main — see `replyMcpOpenTab`'s
   * doc in the preload bridge. */
  replyMcpOpenTab: (payload: { requestId: string; opened: boolean }) => void
}

export interface UseMcpNavigationInput {
  enabled: boolean
  rootItemsRef: { current: FolderItem[] }
  setExpandedIds: (updater: (prev: string[]) => string[]) => void
  setSelectedItemId: (next: string | null) => void
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => void
  openScenarioEditorTab: (scenario: Scenario, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openDesignTab: (design: ApiDesign, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
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
  if (isStompRequest(req)) return 'stomp-request'
  if (isODataRequest(req)) return 'odata-request'
  if (isJsonRpcRequest(req)) return 'jsonrpc-request'
  if (isJsonRpcBatchRequest(req)) return 'jsonrpc-batch-request'
  if (isTrpcRequest(req)) return 'trpc-request'
  if (isAmqpRequest(req)) return 'amqp-request'
  if (isRedisRequest(req)) return 'redis-request'
  if (isKafkaRequest(req)) return 'kafka-request'
  return 'http-request'
}

export function useMcpNavigation(input: UseMcpNavigationInput): void {
  const {
    enabled,
    rootItemsRef,
    setExpandedIds,
    setSelectedItemId,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    openScenarioEditorTab,
    openDesignTab,
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
    const expandAncestors = (itemId: string, items: FolderItem[]): void => {
      const { breadcrumbs } = findItemWithBreadcrumbs(items, itemId)
      const ancestorIds = breadcrumbs.map((b) => b.id).filter((id) => id !== itemId)
      if (ancestorIds.length === 0) return
      setExpandedIds((prev) => Array.from(new Set([...prev, ...ancestorIds])))
    }

    const offOpen = api.onMcpOpenTab(({ requestId, itemId, kind }) => {
      // Read the ref, not the closed-over `rootItemsRef` prop's identity —
      // `.current` is always the freshest tree at the moment this handler
      // actually runs. See the hook's module doc for why that matters.
      const items = rootItemsRef.current
      const ack = (opened: boolean): void => {
        // Defensive: an out-of-date preload bundle may not expose
        // `replyMcpOpenTab`. Calling a missing method throws, and an uncaught
        // throw in this IPC handler wedges the whole renderer-bound MCP
        // channel (every later `evaluate` / `dom-query` hangs). Never let a
        // bad or absent ack escape.
        if (requestId && typeof api.replyMcpOpenTab === 'function') {
          api.replyMcpOpenTab({ requestId, opened })
        }
      }
      try {
        const { breadcrumbs } = findItemWithBreadcrumbs(items, itemId)
        if (kind === 'request') {
          const req = findRequestById(items, itemId)
          if (!req) { ack(false); return }
          const envs = getNearestEnvironmentsForBreadcrumbs(items, breadcrumbs)
          openAnyRequestTab(req, breadcrumbs, envs)
          setSelectedItemId(itemId)
          expandAncestors(itemId, items)
          navigationService.navigateTo(itemId, 'mcp', { type: navTypeForRequest(req) })
          ack(true)
        } else if (kind === 'env-folder') {
          const f = findEnvironmentFolderById(items, itemId)
          if (!f) { ack(false); return }
          openEnvironmentFolderTab(f, breadcrumbs)
          setSelectedItemId(itemId)
          expandAncestors(itemId, items)
          navigationService.navigateTo(itemId, 'mcp', { type: 'environment-folder' })
          ack(true)
        } else if (kind === 'scenario') {
          const s = findScenarioById(items, itemId)
          if (!s) { ack(false); return }
          openScenarioEditorTab(s, breadcrumbs)
          setSelectedItemId(itemId)
          expandAncestors(itemId, items)
          navigationService.navigateTo(itemId, 'mcp', { type: 'scenario-editor' })
          ack(true)
        } else if (kind === 'design') {
          const d = findDesignById(items, itemId)
          if (!d) { ack(false); return }
          openDesignTab(d, breadcrumbs)
          setSelectedItemId(itemId)
          expandAncestors(itemId, items)
          navigationService.navigateTo(itemId, 'mcp', { type: 'design' })
          ack(true)
        } else {
          // kind === 'folder' (only remaining union arm — ActiveKind is exhaustive).
          const f = findFolderById(items, itemId)
          if (!f) { ack(false); return }
          openFolderTab(f, breadcrumbs)
          setSelectedItemId(itemId)
          expandAncestors(itemId, items)
          navigationService.navigateTo(itemId, 'mcp', { type: 'folder' })
          ack(true)
        }
      } catch (err) {
        // A failure resolving/opening the item must not wedge the MCP
        // channel: log it and ack not-opened so main settles the call.
        logger.error('[mcp:open-tab] handler failed; acking not-opened', { error: String(err) })
        ack(false)
      }
    })

    const offReveal = api.onMcpRevealInTree(({ itemId }) => {
      expandAncestors(itemId, rootItemsRef.current)
    })

    const offClose = api.onMcpCloseTab(({ itemId }) => {
      closeTabByItemId(itemId)
    })

    return () => {
      offOpen()
      offReveal()
      offClose()
    }
  }, [enabled, rootItemsRef, setExpandedIds, setSelectedItemId, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, openScenarioEditorTab, openDesignTab, closeTabByItemId])
}

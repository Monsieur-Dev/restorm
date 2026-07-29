/**
 * Listen for `mcp:tree-replace` IPC pushes and replace the renderer's
 * `rootItems` state with the fresh tree. Used by the main-side MCP
 * mutation tools (`import_from_url`, `create_folder`, `create_request`,
 * `rename_item`, `delete_item`, `update_request`, ...) so the user sees
 * changes in the sidebar immediately, without waiting for the autosave
 * round-trip.
 *
 * Registered unconditionally from mount — NOT gated on `mcpEnabled`.
 * `mcpEnabled` only resolves after an async main round-trip
 * (`useMcpEnabled`'s `getConfig()` IPC `invoke`), so gating this
 * listener on it left a real startup window where a fast MCP client
 * (open_project immediately followed by a write tool, well within an
 * automated agent's reach) could fire `mcp:tree-replace` before the
 * listener existed. Electron doesn't replay a dropped IPC message once
 * a listener registers late, so that edit would never reach `rootItems`
 * — and every downstream save check (which reads `rootItems`) would see
 * "nothing changed" for the rest of the session. Registering the
 * listener on mount instead removes that window entirely: it's a no-op
 * subscription (no messages arrive) until an MCP tool actually runs,
 * which itself can't happen before MCP is enabled main-side.
 *
 * Items arrive as plain JSON (lost their class prototype across the
 * IPC boundary). We walk the tree and reify each leaf via
 * `makeReactiveFolder` / `makeReactiveRequest` so subsequent edits in
 * the UI flow back through the standard `*_UPDATED` event pipeline.
 */

import type React from 'react'
import { useEffect } from 'react'
import { makeReactiveFolderItem } from '../types/reactive'
import { collectTreeItemIds } from '../utils/treeItemIds'
import { isAnyFolder, isRequest, isScenario } from '../../../shared/types/collections'
import type { FolderItem } from '../../../shared/types/collections'

interface RestormTreeBridge {
  onMcpTreeReplace: (cb: (payload: unknown) => void) => () => void
}

export interface UseMcpTreeReplaceInput {
  setRootItems: React.Dispatch<React.SetStateAction<FolderItem[]>>
  /**
   * Mutable ref this hook writes with the fresh tree the INSTANT an
   * `mcp:tree-replace` message is processed — synchronously, before
   * `setRootItems` is even called. `setRootItems` only *schedules* a
   * re-render; a same-tick follow-up IPC message (e.g. the `mcp:open-tab`
   * a create's caller sends right after) is handled by a plain
   * `ipcRenderer.on` callback that runs before React gets a chance to
   * commit, so anything reading the `rootItems` *state* (or a ref synced
   * from it via a `useEffect`) still sees the pre-replace tree in that
   * window. Consumers that need the freshest tree inside another IPC
   * handler (`useMcpNavigation`'s `open_tab`/`reveal_in_tree`/`close_tab`)
   * must read `rootItemsRef.current` instead of the `rootItems` prop —
   * this ref is the only thing guaranteed current at that exact moment,
   * because Electron delivers IPC messages FIFO per `webContents` and
   * this write happens synchronously inside the message handler itself.
   */
  rootItemsRef: { current: FolderItem[] }
  /**
   * Mutable ref the renderer flips to `true` immediately before applying
   * an MCP-driven tree replacement, and reads inside the downstream
   * `setCollections` effect so it can pass `source: 'mcp'` (which the
   * zustand store uses to skip the main-side mirror — preventing the
   * roundtrip that would otherwise clobber main's class instances).
   */
  mcpDrivenRef: { current: boolean }
  /**
   * Mutable ref the hook writes with the `mcpVersion` carried by each
   * `mcp:tree-replace` payload — the last main-side tree version this renderer
   * has APPLIED. The renderer's autosave-mirror path (`setCollections` →
   * `syncCollections`) stamps its call with this value so the main store can
   * refuse a mirror that predates a newer MCP mutation (stale-write guard).
   */
  lastMcpVersionRef: { current: number }
  /**
   * Invalidate every workbench tab's content cache after `setRootItems`.
   * `EditorWorkbench` caches each tab's rendered React element keyed
   * by `tab.contentVersion`; without bumping it, the cached element
   * still closes over the pre-replace `folder` / `request` reference,
   * so the user keeps seeing the orphaned tree even though
   * `rootItems` now points at the fresh reactive graph. The most
   * visible symptom: password edits stay stuck in the cached env
   * folder and the save flow (which reads `rootItems`) writes an
   * empty `.env`.
   */
  bumpAllTabContentVersions: () => void
  /**
   * Close every workbench tab whose backing tree item is absent from the
   * freshly-applied tree. A main-driven mutation (e.g. MCP `delete_item`,
   * or a folder move that drops an item) replaces `rootItems` WITHOUT
   * going through the UI delete path that prunes tabs — so without this,
   * a deleted item's editor tab stays open in the workbench with no
   * matching sidebar row, breaking the "every open tab maps to a live
   * item" invariant. Receives the id set of everything still in the tree.
   */
  pruneOrphanTabs: (existingIds: Set<string>) => void
}

export function reifyItem(raw: unknown): FolderItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as FolderItem
  // Only reify recognised items; drop malformed payload entries.
  if (!isScenario(item) && !isAnyFolder(item) && !isRequest(item)) return null
  // Delegate to the shared reifier, which tests `isScenario` BEFORE the
  // folder branch. A scenario carries `items` + `configuration`, so the
  // old `'items' in r → makeReactiveFolder` shortcut mangled a top-level
  // scenario into a folder and dropped its nodes/edges.
  return makeReactiveFolderItem(item)
}

/**
 * Normalise the `mcp:tree-replace` payload into `{ items, mcpVersion }`.
 * Current main sends `{ items: FolderItem[], mcpVersion: number }`; a bare
 * array is tolerated (defensive — an older/other sender) with version 0.
 */
export function readTreeReplacePayload(payload: unknown): { items: unknown[]; mcpVersion: number } | null {
  if (Array.isArray(payload)) return { items: payload, mcpVersion: 0 }
  if (payload && typeof payload === 'object') {
    const p = payload as { items?: unknown; mcpVersion?: unknown }
    if (Array.isArray(p.items)) {
      return { items: p.items, mcpVersion: typeof p.mcpVersion === 'number' ? p.mcpVersion : 0 }
    }
  }
  return null
}

export function useMcpTreeReplace(input: UseMcpTreeReplaceInput): void {
  const { setRootItems, rootItemsRef, mcpDrivenRef, lastMcpVersionRef, bumpAllTabContentVersions, pruneOrphanTabs } = input

  useEffect(() => {
    const root = window as { restorm?: { runtime?: RestormTreeBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    const off = api.onMcpTreeReplace((payload) => {
      const parsed = readTreeReplacePayload(payload)
      if (parsed === null) return
      const next: FolderItem[] = []
      for (const raw of parsed.items) {
        const r = reifyItem(raw)
        if (r !== null) next.push(r)
      }
      // Record the applied main-side version so the downstream autosave
      // mirror stamps `syncCollections` with it (stale-write guard).
      lastMcpVersionRef.current = parsed.mcpVersion
      // Flip the flag BEFORE setRootItems. The downstream zustand
      // `setCollections` effect reads it on the next render to pick
      // `source: 'mcp'` (skipping the main-side mirror). Resetting
      // happens on the same effect after the call lands.
      mcpDrivenRef.current = true
      // Synchronous, ahead of `setRootItems` — see the prop doc on
      // `rootItemsRef` for why this can't wait for a render.
      rootItemsRef.current = next
      setRootItems(next)
      // Close any tab whose backing item vanished in this replacement
      // (e.g. an MCP `delete_item`) — the main-driven path doesn't go
      // through the UI delete's tab pruning, so without this a deleted
      // item's editor tab lingers with no sidebar row.
      pruneOrphanTabs(collectTreeItemIds(next))
      // Invalidate every workbench tab's cached content so the next
      // render re-runs `renderTabContent` against the fresh
      // `rootItems`. See the prop doc for the full rationale.
      bumpAllTabContentVersions()
    })
    return off
  }, [setRootItems, rootItemsRef, mcpDrivenRef, lastMcpVersionRef, bumpAllTabContentVersions, pruneOrphanTabs])
}

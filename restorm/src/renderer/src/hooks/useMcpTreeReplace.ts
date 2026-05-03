/**
 * Listen for `mcp:tree-replace` IPC pushes and replace the renderer's
 * `rootItems` state with the fresh tree. Used by the main-side MCP
 * mutation tools (`import_from_url`, `create_folder`, `create_request`,
 * `rename_item`, `delete_item`) so the user sees changes in the
 * sidebar immediately, without waiting for the autosave round-trip.
 *
 * Disabled outside MCP mode — when `mcpEnabled` is false the listener
 * is never registered.
 *
 * Items arrive as plain JSON (lost their class prototype across the
 * IPC boundary). We walk the tree and reify each leaf via
 * `makeReactiveFolder` / `makeReactiveRequest` so subsequent edits in
 * the UI flow back through the standard `*_UPDATED` event pipeline.
 */

import type React from 'react'
import { useEffect } from 'react'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import type { Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'

interface RestormTreeBridge {
  onMcpTreeReplace: (cb: (payload: unknown) => void) => () => void
}

export interface UseMcpTreeReplaceInput {
  enabled: boolean
  setRootItems: React.Dispatch<React.SetStateAction<(EnvironmentFolder | Folder | Request)[]>>
  /**
   * Mutable ref the renderer flips to `true` immediately before applying
   * an MCP-driven tree replacement, and reads inside the downstream
   * `setCollections` effect so it can pass `source: 'mcp'` (which the
   * zustand store uses to skip the main-side mirror — preventing the
   * roundtrip that would otherwise clobber main's class instances).
   */
  mcpDrivenRef: { current: boolean }
}

function reifyItem(raw: unknown): FolderItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if ('items' in r) {
    return makeReactiveFolder(raw as Folder)
  }
  if ('type' in r) {
    return makeReactiveRequest(raw as Request)
  }
  return null
}

export function useMcpTreeReplace(input: UseMcpTreeReplaceInput): void {
  const { enabled, setRootItems, mcpDrivenRef } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormTreeBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    const off = api.onMcpTreeReplace((payload) => {
      if (!Array.isArray(payload)) return
      const next: (EnvironmentFolder | Folder | Request)[] = []
      for (const raw of payload) {
        const r = reifyItem(raw)
        if (r !== null) next.push(r as EnvironmentFolder | Folder | Request)
      }
      // Flip the flag BEFORE setRootItems. The downstream zustand
      // `setCollections` effect reads it on the next render to pick
      // `source: 'mcp'` (skipping the main-side mirror). Resetting
      // happens on the same effect after the call lands.
      mcpDrivenRef.current = true
      setRootItems(next)
    })
    return off
  }, [enabled, setRootItems, mcpDrivenRef])
}

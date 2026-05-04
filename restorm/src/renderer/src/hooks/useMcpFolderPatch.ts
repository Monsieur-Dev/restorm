/**
 * Bridge MCP `update_folder` IPC into the renderer's reactive folder
 * proxy + force the open folder tab to repaint. Symmetric with
 * `useMcpRequestPatch` (see that file's header for the why).
 */

import { useEffect } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { findItemById } from '../utils/treeSearch'
import { updateReactiveProperty } from '../components/RequestTabViews/requestTabViewUtils'
import type { FolderItem } from '../../../shared/types/collections'
import { isAnyFolder } from '../../../shared/types/collections'

interface RestormFolderPatchBridge {
  onMcpFolderUpdated: (cb: (payload: { itemId: string; patch: Record<string, unknown> }) => void) => () => void
}

export interface UseMcpFolderPatchInput {
  enabled: boolean
  rootItems: FolderItem[]
  bumpTabContentVersionFor: (itemId: string) => void
}

export function useMcpFolderPatch(input: UseMcpFolderPatchInput): void {
  const { enabled, rootItems, bumpTabContentVersionFor } = input

  useEffect(() => {
    if (!enabled) return
    const root = window as { restorm?: { runtime?: RestormFolderPatchBridge } }
    const api = root.restorm?.runtime
    if (!api) return
    const off = api.onMcpFolderUpdated(({ itemId, patch }) => {
      const folder = findItemById(rootItems, itemId)
      if (!folder || !isAnyFolder(folder)) return
      // Per-field assignment via the reactive proxy fires the standard
      // FOLDER_UPDATED event chain (search index, dirty detection, …).
      for (const [key, value] of Object.entries(patch)) {
        updateReactiveProperty(folder as unknown as Record<string, unknown>, key, value)
      }
      // Force the open folder tab to re-render — tab content (notes,
      // documentation, tag list, env list…) is derived from the folder
      // ref captured at mount time, same uncontrolled pattern the
      // request panels use. Bumping contentVersion remounts the panel.
      bumpTabContentVersionFor(itemId)
      // Mirror the request-side event so any panel that subscribes for
      // a generic "transport replaced" refresh triggers cleanly.
      eventBus.emitLocalSync('folder:updated', { folderId: itemId })
    })
    return off
  }, [enabled, rootItems, bumpTabContentVersionFor])
}

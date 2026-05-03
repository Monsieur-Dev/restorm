/**
 * Navigation tools — they have side-effects on the UI (opening a tab,
 * scrolling the sidebar) but never mutate the model. They exist so the
 * AI can SHOW the user what it's looking at: "I'm reading this
 * request", "I just opened this folder". Pairs naturally with the read
 * tools in `./read.ts`.
 *
 * The flow is one-way: main validates the target id against the
 * CollectionStore, then fires an IPC the renderer's listeners pick up
 * and turn into a workbench tab open / sidebar reveal. We don't wait
 * for renderer ack — the model-side validation is enough to surface a
 * clean error to the MCP client when the id is unknown, and the
 * renderer is forgiving about unknown ids anyway (no-ops gracefully).
 */

import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { isAnyFolder, isEnvironmentFolder, isRequest } from '../../../shared/models'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function describeKind(itemId: string): 'request' | 'folder' | 'env-folder' | null {
  const target = collectionStore.findById(itemId)
  if (!target) return null
  if (isRequest(target)) return 'request'
  if (isEnvironmentFolder(target)) return 'env-folder'
  if (isAnyFolder(target)) return 'folder'
  return null
}

export function registerNavigationTools(mcp: McpService): void {
  mcp.registerTool(
    'open_tab',
    {
      title: 'Open item in workbench tab',
      description:
        'Open a folder, env-folder or request in a new workbench tab — focuses the existing tab ' +
        'if one already shows the item. Validates the id against the open project; returns a ' +
        'clean error when unknown so the AI knows it picked the wrong reference. The tab opens ' +
        'in the user\'s active window; multi-window setups receive the broadcast in every window ' +
        'and the renderer picks the focused one.',
      inputSchema: {
        itemId: z.string().min(1).describe('Folder / env-folder / request id to open.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const itemId = typeof argRecord['itemId'] === 'string' ? argRecord['itemId'] : ''
      if (!itemId) return errorReply('itemId is required')
      const kind = describeKind(itemId)
      if (!kind) return errorReply(`No item with id ${itemId}`)
      broadcast('mcp:open-tab', { itemId, kind })
      return jsonReply({ itemId, kind, queued: true })
    }
  )

  mcp.registerTool(
    'reveal_in_tree',
    {
      title: 'Reveal item in sidebar tree',
      description:
        'Expand the sidebar ancestors of the item, scroll the tree to the node, and select it. ' +
        'Useful so the user can see what the AI is referring to without opening a tab. Validates ' +
        'the id against the open project.',
      inputSchema: {
        itemId: z.string().min(1).describe('Folder / env-folder / request id to reveal.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const itemId = typeof argRecord['itemId'] === 'string' ? argRecord['itemId'] : ''
      if (!itemId) return errorReply('itemId is required')
      const kind = describeKind(itemId)
      if (!kind) return errorReply(`No item with id ${itemId}`)
      broadcast('mcp:reveal-in-tree', { itemId, kind })
      return jsonReply({ itemId, kind, queued: true })
    }
  )
}

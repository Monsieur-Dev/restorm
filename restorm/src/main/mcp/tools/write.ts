/**
 * Mutation tools — create / rename / delete folders + requests. The
 * MCP client drives full project lifecycle (build a tree of folders +
 * requests) without touching the UI. Mutations go through
 * CollectionStore which already emits the right PubSub / event-bus
 * events; the renderer's GraphQL subscriptions pick them up and
 * refresh the sidebar in place.
 *
 * Persistence: each mutation broadcasts `file:autosave-trigger` so the
 * renderer-driven autosave path persists the change. Returning before
 * the renderer round-trip completes is intentional — MCP tools should
 * not block on UI work, and the in-memory CollectionStore is already
 * authoritative for the next read tool call.
 */

import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { isAnyFolder, isEnvironmentFolder, isRequest } from '../../../shared/models'
import { broadcastTreeReplace } from './import'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function triggerSave(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('file:autosave-trigger')
  }
}

const REQUEST_TYPES = ['http', 'graphql', 'grpc', 'soap', 'websocket', 'odata', 'auth'] as const

export function registerWriteTools(mcp: McpService): void {
  mcp.registerTool(
    'create_folder',
    {
      title: 'Create folder',
      description:
        'Create a new folder. With `parentId` null (or omitted), creates a root env-folder. ' +
        'With a `parentId` pointing at an existing folder / env-folder, creates a child folder. ' +
        '`kind: "env-folder"` only applies at the root; nested folders are always plain folders.',
      inputSchema: {
        name: z.string().min(1).describe('Folder name as it appears in the sidebar.'),
        parentId: z.string().min(1).optional().describe('Parent folder id. Omit to create a root env-folder.'),
        kind: z.enum(['folder', 'env-folder']).optional().describe(
          'Default `env-folder` when `parentId` is omitted, `folder` otherwise.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const name = typeof argRecord['name'] === 'string' ? argRecord['name'] : ''
      if (!name) return errorReply('name is required')
      const parentIdRaw = argRecord['parentId']
      const parentId = typeof parentIdRaw === 'string' && parentIdRaw.length > 0 ? parentIdRaw : null
      if (parentId !== null) {
        const parent = collectionStore.findById(parentId)
        if (!parent || !isAnyFolder(parent)) {
          return errorReply(`parentId ${parentId} doesn't point at a folder`)
        }
      }
      const created = collectionStore.createFolder(parentId, { name })
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ id: created.id, name: created.name, parentId })
    }
  )

  mcp.registerTool(
    'create_request',
    {
      title: 'Create request',
      description:
        'Create a new request in a folder. `protocol` picks the request type (http / graphql / ' +
        'grpc / soap / websocket / odata / auth). Returns `{ id, name, protocol, parentId }`. The ' +
        'created request is bare — fill in URL / method / headers via `update_request` (TODO) or ' +
        'in the UI.',
      inputSchema: {
        parentFolderId: z.string().min(1).describe('Folder or env-folder id to create the request in.'),
        name: z.string().min(1).describe('Request name as it appears in the sidebar.'),
        protocol: z.enum(REQUEST_TYPES).describe('Request type (one of the supported protocols).')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const parentFolderId = typeof argRecord['parentFolderId'] === 'string' ? argRecord['parentFolderId'] : ''
      const name = typeof argRecord['name'] === 'string' ? argRecord['name'] : ''
      const protocol = typeof argRecord['protocol'] === 'string' ? argRecord['protocol'] as typeof REQUEST_TYPES[number] : null
      if (!parentFolderId) return errorReply('parentFolderId is required')
      if (!name) return errorReply('name is required')
      if (protocol === null || !REQUEST_TYPES.includes(protocol)) {
        return errorReply(`protocol must be one of: ${REQUEST_TYPES.join(', ')}`)
      }
      const parent = collectionStore.findById(parentFolderId)
      if (!parent || !isAnyFolder(parent)) {
        return errorReply(`parentFolderId ${parentFolderId} doesn't point at a folder`)
      }
      const created = collectionStore.createRequest(parentFolderId, { type: protocol, name })
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ id: created.id, name: created.name, protocol, parentId: parentFolderId })
    }
  )

  mcp.registerTool(
    'rename_item',
    {
      title: 'Rename a folder or request',
      description:
        'Update the `name` of an existing folder, env-folder or request. The new name appears in ' +
        'the sidebar immediately via the renderer\'s GraphQL subscriptions.',
      inputSchema: {
        id: z.string().min(1).describe('Item id to rename.'),
        newName: z.string().min(1).describe('New name.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      const newName = typeof argRecord['newName'] === 'string' ? argRecord['newName'] : ''
      if (!id) return errorReply('id is required')
      if (!newName) return errorReply('newName is required')
      const target = collectionStore.findById(id)
      if (!target) return errorReply(`No item with id ${id}`)
      if (isRequest(target)) {
        const updated = collectionStore.updateRequest(id, { name: newName })
        if (!updated) return errorReply(`updateRequest failed for ${id}`)
        broadcastTreeReplace()
        triggerSave()
        return jsonReply({ id, kind: 'request', name: updated.name })
      }
      if (isAnyFolder(target)) {
        const updated = collectionStore.updateFolder(id, { name: newName })
        if (!updated) return errorReply(`updateFolder failed for ${id}`)
        broadcastTreeReplace()
        triggerSave()
        return jsonReply({ id, kind: isEnvironmentFolder(updated) ? 'env-folder' : 'folder', name: updated.name })
      }
      return errorReply(`Item ${id} is not a folder, env-folder or request`)
    }
  )

  mcp.registerTool(
    'delete_item',
    {
      title: 'Delete a folder or request',
      description:
        'Delete a folder, env-folder or request by id. Folder deletes cascade to all child items. ' +
        'No confirmation prompt — caller is responsible for guarding destructive deletes.',
      inputSchema: {
        id: z.string().min(1).describe('Item id to delete.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')
      const target = collectionStore.findById(id)
      if (!target) return errorReply(`No item with id ${id}`)
      if (isRequest(target)) {
        const ok = collectionStore.deleteRequest(id)
        if (!ok) return errorReply(`deleteRequest failed for ${id}`)
        broadcastTreeReplace()
        triggerSave()
        return jsonReply({ id, kind: 'request', deleted: true })
      }
      if (isAnyFolder(target)) {
        const ok = collectionStore.deleteFolder(id)
        if (!ok) return errorReply(`deleteFolder failed for ${id}`)
        broadcastTreeReplace()
        triggerSave()
        return jsonReply({ id, kind: isEnvironmentFolder(target) ? 'env-folder' : 'folder', deleted: true })
      }
      return errorReply(`Item ${id} is not a folder, env-folder or request`)
    }
  )
}

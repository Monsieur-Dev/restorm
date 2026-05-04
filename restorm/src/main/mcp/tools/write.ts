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
import { isAnyFolder, isEnvironmentFolder, isRequest, KeyValue } from '../../../shared/models'
import { broadcastTreeReplace } from './import'

/**
 * Walk a `update_request` patch and convert any plain-object key-value
 * entries (headers / params / pathParams / metadata) into real
 * `KeyValue` class instances. Without this, `request.toPlainObject()`
 * crashes when the next event emit walks the array — `p.toPlainObject`
 * is undefined on a plain object.
 */
function reifyKeyValueArrays(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  for (const field of ['headers', 'params', 'pathParams', 'metadata']) {
    const arr = out[field]
    if (Array.isArray(arr)) {
      out[field] = arr.map((entry: unknown): unknown => {
        if (entry instanceof KeyValue) return entry
        if (entry !== null && typeof entry === 'object') {
          return KeyValue.fromPlain(entry as Parameters<typeof KeyValue.fromPlain>[0])
        }
        return entry
      })
    }
  }
  return out
}

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
        'created request is bare — fill in URL / method / headers via `update_request` or ' +
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
    'update_request',
    {
      title: 'Update arbitrary fields on a request',
      description:
        'Apply a partial-patch to an existing request: any field on the typed request shape is ' +
        'fair game (`url`, `method`, `headers`, `params`, `pathParams`, `body`, plus protocol-' +
        'specific fields like GraphQL `query` / `variables`, gRPC `service` / `metadata`, etc.). ' +
        'Arrays are replaced wholesale — to mutate one entry of `pathParams`, fetch the full ' +
        'array via `get_request`, modify it, then send the full array back. Triggers a tree ' +
        'broadcast so the open workbench tab repaints with the new values, and an autosave ' +
        'so the change persists. Cannot change the `id` or `type` (use create + delete for that).',
      inputSchema: {
        id: z.string().min(1).describe('Request id to patch.'),
        patch: z.record(z.string(), z.unknown()).describe(
          'Partial request shape. Whitelisted top-level keys: url, method, headers, params, ' +
          'pathParams, body, name, description, query, variables, service, callType, ' +
          'requestMessage, metadata, soapAction, operation, soapBody, protocol, event, message. ' +
          '`id` and `type` are dropped silently — protected.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')
      const patchRaw = argRecord['patch']
      if (!patchRaw || typeof patchRaw !== 'object' || Array.isArray(patchRaw)) {
        return errorReply('patch must be an object')
      }
      const target = collectionStore.findById(id)
      if (!target || !isRequest(target)) {
        return errorReply(`No request with id ${id}`)
      }
      // Strip protected fields. The CollectionStore mutation API blindly
      // Object.assigns; passing a new id would corrupt every map keyed
      // by the old one, and `type` change would mismatch the class
      // instance with the actual request kind.
      const { id: _id, type: _type, ...rawSafePatch } = patchRaw as Record<string, unknown>
      const safePatch = reifyKeyValueArrays(rawSafePatch)
      const updated = collectionStore.updateRequest(id, safePatch as Partial<Request>)
      if (!updated) return errorReply(`updateRequest failed for ${id}`)
      // Patch the renderer's reactive request proxy in place too — without
      // this, an open workbench tab keeps showing the pre-patch values
      // because it captured the old request reference at mount time.
      // The renderer hook (`useMcpRequestPatch`) finds the live request
      // in `rootItems` by id and assigns each patched field via the
      // reactive proxy, which fires the standard REQUEST_UPDATED event
      // chain and refreshes every subscriber (request panel, status bar,
      // search index, etc.) just like a user keystroke would.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('mcp:request-updated', { itemId: id, patch: rawSafePatch })
        }
      }
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ id, name: updated.name, type: updated.type, patchedFields: Object.keys(safePatch) })
    }
  )

  mcp.registerTool(
    'update_folder',
    {
      title: 'Update arbitrary fields on a folder or env-folder',
      description:
        'Apply a partial-patch to an existing folder. Whitelisted fields cover both Folder and ' +
        'EnvironmentFolder shapes: `name`, `documentation`, `notes`, `tags`, `tagColors`, ' +
        '`configuration`, `environments` (env-folders only), `enumDefinitions`, `apiUpdate`. ' +
        '`id`, `items` and `folderType` are protected (use create / move / delete for those). ' +
        'Triggers an MCP-driven refresh so an open folder tab repaints.',
      inputSchema: {
        id: z.string().min(1).describe('Folder or env-folder id to patch.'),
        patch: z.record(z.string(), z.unknown()).describe(
          'Partial folder shape. Protected keys (`id`, `items`, `folderType`) are dropped silently.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')
      const patchRaw = argRecord['patch']
      if (!patchRaw || typeof patchRaw !== 'object' || Array.isArray(patchRaw)) {
        return errorReply('patch must be an object')
      }
      const target = collectionStore.findById(id)
      if (!target || !isAnyFolder(target)) {
        return errorReply(`No folder with id ${id}`)
      }
      // Same protections as update_request: id / items / folderType
      // would corrupt the in-memory tree if changed.
      const { id: _id, items: _items, folderType: _folderType, ...safePatch } = patchRaw as Record<string, unknown>
      const updated = collectionStore.updateFolder(id, safePatch as Partial<typeof target>)
      if (!updated) return errorReply(`updateFolder failed for ${id}`)
      // Mirror the request-update IPC chain so an open folder tab
      // refreshes in place — the renderer hook applies the patch via
      // the reactive proxy + bumps the workbench tab's contentVersion.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('mcp:folder-updated', { itemId: id, patch: safePatch })
        }
      }
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ id, name: updated.name, kind: isEnvironmentFolder(updated) ? 'env-folder' : 'folder', patchedFields: Object.keys(safePatch) })
    }
  )

  mcp.registerTool(
    'set_favorite',
    {
      title: 'Toggle (or set) the favorite flag on an item',
      description:
        'Mark a folder, env-folder or request as favorite (or remove it). Favorites are a ' +
        'per-project store keyed by item id; the renderer\'s sidebar Favorites pane + the H1 ' +
        'star toggle update automatically. With `favorite: true` / `false` the state is set ' +
        'explicitly; omit it to flip the current value.',
      inputSchema: {
        itemId: z.string().min(1).describe('Folder / env-folder / request id whose favorite flag to flip.'),
        favorite: z.boolean().optional().describe('Optional explicit value. Omit to toggle.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const itemId = typeof argRecord['itemId'] === 'string' ? argRecord['itemId'] : ''
      if (!itemId) return errorReply('itemId is required')
      const target = collectionStore.findById(itemId)
      if (!target) return errorReply(`No item with id ${itemId}`)
      const explicit = typeof argRecord['favorite'] === 'boolean' ? argRecord['favorite'] : null
      // Renderer-side store. Broadcast lets the renderer call its own
      // `favoritesStoreToggle` / `favoritesStoreSet` and bump the
      // re-render counter — main has no view of the favorites store.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('mcp:set-favorite', { itemId, favorite: explicit })
        }
      }
      return jsonReply({ itemId, requested: explicit, queued: true })
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

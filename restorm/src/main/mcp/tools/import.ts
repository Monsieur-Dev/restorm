/**
 * Import tools — pull a spec (Swagger / OpenAPI / GraphQL / Postman /
 * curl / …) from a URL or local file and commit it into the open
 * project. Detection lives in `ImportManager.importFrom`; this module
 * only handles the MCP wrapping + insertion into the CollectionStore.
 *
 * For URL imports of Swagger / OpenAPI specs the typical result is a
 * single root-level `EnvironmentFolder` containing all the imported
 * requests. We walk the returned `items` and either:
 *   - append every top-level item to the existing root collections, or
 *   - append them under the `parentFolderId` if specified
 *
 * After insertion we trigger the renderer-side autosave via
 * `file:autosave-trigger` so the imported tree lands on disk before the
 * user has a chance to edit anything.
 */

import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { McpService } from 'electron-core-ui'
import { eventBusService } from 'electron-core-ui/main'
import { collectionStore, pubsub, PUBSUB_TOPICS } from '../../services/CollectionStore'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { importFrom } from '../../services/import/ImportManager'
import { isAnyFolder, isEnvironmentFolder, isRequest, type FolderItem, type EnvironmentFolder, type Environment } from '../../../shared/models'
import { cloneForEventBus } from '../../../shared/utils/cloneForEventBus'

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

/**
 * Broadcast the current project tree (collections root) to every
 * renderer window. Renderers listen via `onMcpTreeReplace` and replace
 * their rootItems state after reifying via `makeReactive*`. Use after
 * any main-driven mutation (import, create, rename, delete) so the
 * sidebar reflects the change immediately — pubsub events alone don't
 * cover newly-introduced ids that aren't in the renderer's apollo
 * cache yet.
 */
export function broadcastTreeReplace(): void {
  // `cloneForEventBus` over `JSON.parse(JSON.stringify(...))`: the
  // latter calls `PasswordValue.toJSON()` which strips the plaintext,
  // so the renderer would receive a password-less tree and
  // `setRootItems(reactiveWrap(tree))` would orphan every plaintext
  // the user had typed into the previous reactive tree. The custom
  // walker copies own enumerable props (so the `value` field
  // survives), never touches `toJSON`. Class instances still arrive
  // on the renderer side as POJOs (constructors lost over IPC
  // anyway), but with `{ type, value }` intact — `normalizeValueType`
  // re-instantiates them on reify.
  const tree = cloneForEventBus(collectionStore.getCollections()) as unknown
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mcp:tree-replace', tree)
  }
}

/**
 * Emit `ENVIRONMENT_CREATED` events for every environment in the
 * imported tree. ContextService listens to these and loads the env's
 * variables into its `transformedContexts` map; without this step,
 * `run_request` (and any tool that depends on Handlebars-resolved
 * URLs / headers / bodies) sees raw `{{baseUrl}}` template strings
 * instead of expanded values, and the executor errors with
 * "Invalid URL". Walks the tree post-push because the importers stamp
 * envs onto the EnvironmentFolder roots, never on inner folders.
 */
function emitEnvironmentEvents(items: readonly FolderItem[]): void {
  const visit = (item: FolderItem): void => {
    if (isEnvironmentFolder(item)) {
      for (const env of item.environments) {
        const document = typeof (env as { toPlainObject?: () => Environment }).toPlainObject === 'function'
          ? (env as { toPlainObject: () => Environment }).toPlainObject()
          : env
        const payload: DocumentChangedPayload = {
          id: env.id,
          type: 'environment',
          document,
          parentFolderId: item.id
        }
        void eventBusService.emit(DocumentEvents.ENVIRONMENT_CREATED, payload)
        pubsub.publish(PUBSUB_TOPICS.ENVIRONMENT_CREATED, env)
      }
    }
    if (isAnyFolder(item)) {
      for (const child of item.items) visit(child)
    }
  }
  for (const item of items) visit(item)
}

function countItems(items: readonly FolderItem[]): { folders: number; requests: number } {
  let folders = 0
  let requests = 0
  for (const item of items) {
    if (isRequest(item)) requests += 1
    else if (isAnyFolder(item)) {
      folders += 1
      const nested = countItems(item.items)
      folders += nested.folders
      requests += nested.requests
    }
  }
  return { folders, requests }
}

export function registerImportTools(mcp: McpService): void {
  mcp.registerTool(
    'import_from_url',
    {
      title: 'Import API spec from URL',
      description:
        'Fetch a spec (Swagger / OpenAPI / GraphQL SDL / Postman / Bruno / curl / …) from a URL ' +
        'and commit it into the open project. Format auto-detected from content. With ' +
        '`parentFolderId`, the imported items are nested under that folder; without, they are ' +
        'appended to the root collections. Returns counts so the caller can verify the import. ' +
        'Triggers the renderer-side autosave so the new content persists immediately.',
      inputSchema: {
        url: z.string().min(1).describe('HTTP(S) URL of the spec to import.'),
        parentFolderId: z.string().min(1).optional().describe(
          'Optional folder id to nest the imported items under. Omit to import as root collections.'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const url = typeof argRecord['url'] === 'string' ? argRecord['url'] : ''
      if (!url) return errorReply('url is required')
      const parentIdRaw = argRecord['parentFolderId']
      const parentId = typeof parentIdRaw === 'string' && parentIdRaw.length > 0 ? parentIdRaw : null

      let parent: FolderItem | null = null
      if (parentId !== null) {
        parent = collectionStore.findById(parentId)
        if (!parent || !isAnyFolder(parent)) {
          return errorReply(`parentFolderId ${parentId} doesn't point at a folder`)
        }
      }

      const result = await importFrom(url, { dryRun: false })
      if (!result.success) {
        return errorReply(`import failed: ${result.error ?? 'unknown error'}${result.statusCode !== undefined ? ` (HTTP ${result.statusCode})` : ''}`)
      }
      if (result.items.length === 0) {
        return jsonReply({ url, format: result.format ?? null, imported: { folders: 0, requests: 0 }, items: [] })
      }

      // Stamp every freshly-imported env folder with the same
      // `apiUpdate` payload the UI's Import modal writes — sourceUrl
      // + lastImportedAt + payloadChecksum. Without this the env
      // folder's Home tab shows an empty "API spec updates" section
      // and the Refresh button has nothing to compare against, so an
      // MCP-driven import lands a folder the user can never refresh
      // through the UI. The checksum already comes from `importFrom`,
      // so this is a pure copy-onto-folder step.
      const stampApiUpdate = (envFolder: EnvironmentFolder): void => {
        const existing = (envFolder as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate ?? {}
        ;(envFolder as unknown as { apiUpdate?: Record<string, unknown> }).apiUpdate = {
          sourceUrl: url,
          lastImportedAt: Date.now(),
          ...existing,
          ...(result.payloadChecksum !== undefined ? { payloadChecksum: result.payloadChecksum } : {})
        }
      }

      const summaries: { id: string; name: string; kind: 'folder' | 'env-folder' | 'request' }[] = []
      const counts = { folders: 0, requests: 0 }
      for (const item of result.items) {
        if (parent !== null && isAnyFolder(parent)) {
          // Importing under an existing folder: stamp every imported
          // env folder so it carries the refresh config. A bare
          // request / folder nested under an existing parent has no
          // env folder of its own — the parent already owns one.
          if (isEnvironmentFolder(item)) stampApiUpdate(item)
          parent.items.push(item)
        } else {
          // Root-level: every imported item must be an env-folder when
          // no parent is given (the renderer's tree expects EnvironmentFolder
          // at the top). Wrap a bare folder / request if necessary.
          if (isEnvironmentFolder(item)) {
            stampApiUpdate(item)
            const collections = collectionStore.getCollections()
            collections.push(item)
          } else {
            const wrapper: EnvironmentFolder = {
              id: `imported-${Date.now()}-${String(Math.random()).slice(2, 8)}`,
              name: result.format ? `Imported (${result.format})` : 'Imported',
              folderType: 'environment',
              fileFormatVersion: 1,
              tags: [],
              configuration: {} as EnvironmentFolder['configuration'],
              items: [item],
              environments: []
            } as unknown as EnvironmentFolder
            stampApiUpdate(wrapper)
            collectionStore.getCollections().push(wrapper)
          }
        }
        const sub = countItems([item])
        counts.folders += sub.folders
        counts.requests += sub.requests
        const kind: 'folder' | 'env-folder' | 'request' = isRequest(item) ? 'request' : isEnvironmentFolder(item) ? 'env-folder' : 'folder'
        summaries.push({ id: item.id, name: item.name, kind })
      }
      // Reify the freshly-pushed plain JSON items into class instances
      // (importer parsers DO produce class instances, but the broadcast
      // round-trip + bonkers serialisation shapes mean some items can
      // arrive as plain objects on certain code paths). Calling
      // setCollections with the current tree triggers
      // `ensureEnvironmentFolderInstance` + nested `reifyItem` so every
      // request/folder ends up as a real class instance — without this,
      // subsequent `serializeRequest` / `toPlainObject` calls (e.g.
      // from `get_request`) throw "is not a function".
      collectionStore.setCollections(collectionStore.getCollections(), 'user')
      // Fire ENVIRONMENT_CREATED for every imported env so ContextService
      // loads the variables into its transformedContexts map. Without
      // this, `run_request` sees raw `{{baseUrl}}` strings.
      emitEnvironmentEvents(result.items)
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({
        url,
        format: result.format ?? null,
        imported: counts,
        rootItems: summaries
      })
    }
  )
}

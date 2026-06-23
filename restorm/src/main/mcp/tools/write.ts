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
import { contextService } from '../../services/ContextService'
import { isAnyFolder, isEnvironmentFolder, isRequest, isScenario, KeyValue, Environment } from '../../../shared/models'
import { isSoapRequest } from '../../../shared/types/requests/index'
import type { EnvironmentFolder, CustomValueList, CustomValueEntry } from '../../../shared/types/collections'
import { broadcastTreeReplace } from './import'
import { broadcastScenario } from './scenario'
import { valueSourceRegistry } from '../../../shared/secrets/valueSourceRegistry'

/**
 * If `value` is a secret reference (`{ type: 'secret', … }`), validate its
 * `source` against the registry of known value sources and require the params
 * declared `required` by the source's `paramSchema`. Returns an error message
 * to reply with, or `null` when the value is valid (or isn't a secret at all).
 *
 * This is the MCP write-path gate: `KeyValue.fromPlain` would otherwise build a
 * `SecretValue` with an empty / bogus `source` that no resolver can satisfy,
 * surfacing as a silent runtime resolution failure rather than a clear
 * tool-call error. The registry is populated at main boot by
 * `registerBuiltinSources`, so a future source is accepted automatically.
 */
function validateSecretValue(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as { type?: unknown; source?: unknown; params?: unknown }
  if (v.type !== 'secret') return null
  const source = typeof v.source === 'string' ? v.source : ''
  if (source === '') {
    const ids = valueSourceRegistry.list().map((d) => d.id).join(', ')
    return `secret value requires a non-empty "source" (one of: ${ids || 'none registered'})`
  }
  const descriptor = valueSourceRegistry.get(source)
  if (!descriptor) {
    const ids = valueSourceRegistry.list().map((d) => d.id).join(', ')
    return `unknown secret source "${source}" (known: ${ids || 'none registered'})`
  }
  const params = v.params !== null && typeof v.params === 'object' ? (v.params as Record<string, unknown>) : {}
  for (const field of descriptor.paramSchema ?? []) {
    if (field.required === true) {
      const val = params[field.key]
      if (val === undefined || val === null || val === '') {
        return `secret source "${source}" requires param "${field.key}"`
      }
    }
  }
  return null
}

/**
 * Walk a `update_request` patch and convert any plain-object key-value
 * entries (headers / params / pathParams / metadata / producedHeaders) into
 * real `KeyValue` class instances. Without this, `request.toPlainObject()`
 * crashes when the next event emit walks the array — `p.toPlainObject`
 * is undefined on a plain object.
 */
function reifyKeyValueArrays(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  for (const field of ['headers', 'params', 'pathParams', 'metadata', 'producedHeaders']) {
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

/**
 * Walk an `update_folder` patch's `environments` array and turn every
 * plain-object entry into a real `Environment` class instance (which
 * itself reifies each `variable` into a `KeyValue` with the matching
 * `ValueType` subclass). Without this, the next `toPlainObject()` call
 * downstream — emitted by `CollectionStore.emitFolderUpdated` — crashes
 * with `e.toPlainObject is not a function` on the plain-object env.
 */
function reifyEnvironmentsArray(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  const envs = out['environments']
  if (Array.isArray(envs)) {
    out['environments'] = envs.map((entry: unknown): unknown => {
      if (entry instanceof Environment) return entry
      if (entry !== null && typeof entry === 'object') {
        return Environment.fromPlain(entry as Parameters<typeof Environment.fromPlain>[0])
      }
      return entry
    })
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
      titleKey: 'mcpToolTitles.createFolder',
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
      titleKey: 'mcpToolTitles.createRequest',
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
    'create_scenario',
    {
      titleKey: 'mcpToolTitles.createScenario',
      title: 'Create scenario',
      description:
        'Create a new scenario (the dataflow-graph tree item) as a child of a folder, env-folder, or ' +
        'another scenario (scenarios double as folder-like containers). Returns `{ id, name, parentId }`. ' +
        'The scenario is empty (no nodes / edges / params) — use `create_scenario_node` + ' +
        '`connect_scenario_nodes` to fill it.',
      inputSchema: {
        parentId: z.string().min(1).describe('Folder, env-folder, or scenario id to create the scenario under.'),
        name: z.string().min(1).describe('Scenario name as it appears in the sidebar.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const parentId = typeof argRecord['parentId'] === 'string' ? argRecord['parentId'] : ''
      const name = typeof argRecord['name'] === 'string' ? argRecord['name'] : ''
      if (!parentId) return errorReply('parentId is required')
      if (!name) return errorReply('name is required')
      const parent = collectionStore.findById(parentId)
      if (!parent || (!isAnyFolder(parent) && !isScenario(parent))) {
        return errorReply(`parentId ${parentId} doesn't point at a folder or scenario`)
      }
      const created = collectionStore.createScenario(parentId, { name })
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ id: created.id, name: created.name, parentId })
    }
  )

  mcp.registerTool(
    'rename_item',
    {
      titleKey: 'mcpToolTitles.renameItem',
      title: 'Rename a folder, request or scenario',
      description:
        'Update the `name` of an existing folder, env-folder, request or scenario. The new name ' +
        'appears in the sidebar immediately via the renderer\'s GraphQL subscriptions.',
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
      if (isScenario(target)) {
        const updated = collectionStore.updateScenario(id, { name: newName })
        if (!updated) return errorReply(`updateScenario failed for ${id}`)
        broadcastScenario(updated)
        return jsonReply({ id, kind: 'scenario', name: updated.name })
      }
      return errorReply(`Item ${id} is not a folder, env-folder, request or scenario`)
    }
  )

  mcp.registerTool(
    'update_request',
    {
      titleKey: 'mcpToolTitles.updateRequest',
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
          'requestMessage, metadata, soapAction, operation, soapBody, protocol, event, message, server. ' +
          '`id` and `type` are dropped silently — protected. `body.type` must be one of ' +
          '`text` / `file` / `form-data` / `x-www-form-urlencoded` (the canonical HTTPRequestBody ' +
          'discriminator values); to send a JSON payload use `{type: "text", content: "{…json…}"}`.'
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
      // Reject `body.type` values the executor / UI can't render. The
      // 4 canonical types form the entire `HTTPRequestBody` union; a
      // caller stuffing anything else (e.g. `'json'`) used to land in
      // an empty body editor and reach the wire as a payload-less
      // POST, surfacing as a generic 4xx from the upstream server.
      const VALID_BODY_TYPES = ['text', 'file', 'form-data', 'x-www-form-urlencoded'] as const
      const patchedBody = (rawSafePatch as { body?: unknown }).body
      // SOAP carries its body as a raw XML envelope STRING, not an
      // `HTTPRequestBody` object — the object/`type` validation below only
      // applies to the HTTP-shaped body union, so skip it for SOAP requests.
      if (patchedBody !== undefined && patchedBody !== null && !isSoapRequest(target)) {
        if (typeof patchedBody !== 'object' || Array.isArray(patchedBody)) {
          return errorReply('body must be an object')
        }
        const bodyType = (patchedBody as { type?: unknown }).type
        if (
          bodyType !== undefined &&
          (typeof bodyType !== 'string' ||
            !(VALID_BODY_TYPES as readonly string[]).includes(bodyType))
        ) {
          return errorReply(
            `body.type must be one of: ${VALID_BODY_TYPES.join(', ')} (got: ${JSON.stringify(bodyType)})`
          )
        }
      }
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
      titleKey: 'mcpToolTitles.updateFolder',
      title: 'Update arbitrary fields on a folder or env-folder',
      description:
        'Apply a partial-patch to an existing folder. Whitelisted fields cover both Folder and ' +
        'EnvironmentFolder shapes: `name`, `notes`, `tags`, `tagColors`, ' +
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
      const { id: _id, items: _items, folderType: _folderType, ...rawPatch } = patchRaw as Record<string, unknown>
      // Reify `environments` so a JSON-only MCP caller can hand us
      // `{ variables: [{key, value: {type:'string', value:'…'}}, …] }`
      // and the downstream `emitFolderUpdated` → `toPlainObject` chain
      // still works (it would otherwise crash on plain-object envs).
      const safePatch = reifyEnvironmentsArray(rawPatch)
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
      titleKey: 'mcpToolTitles.setFavorite',
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
      titleKey: 'mcpToolTitles.deleteItem',
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
      if (isScenario(target)) {
        const ok = collectionStore.deleteScenario(id)
        if (!ok) return errorReply(`deleteScenario failed for ${id}`)
        broadcastTreeReplace()
        triggerSave()
        return jsonReply({ id, kind: 'scenario', deleted: true })
      }
      if (isAnyFolder(target)) {
        const ok = collectionStore.deleteFolder(id)
        if (!ok) return errorReply(`deleteFolder failed for ${id}`)
        broadcastTreeReplace()
        triggerSave()
        return jsonReply({ id, kind: isEnvironmentFolder(target) ? 'env-folder' : 'folder', deleted: true })
      }
      return errorReply(`Item ${id} is not a folder, env-folder, scenario or request`)
    }
  )

  // ────────────────────────────────────────────────────────────────────
  // Env-variable CRUD — list / set / delete variables on an
  // `Environment` inside an env-folder without round-tripping through
  // `update_folder` (which requires the caller to send the whole
  // environments array). The previous workflow had MCP clients editing
  // the YAML on disk to seed `JWTBearer_token`; these tools collapse
  // that into a single explicit call per variable.
  // ────────────────────────────────────────────────────────────────────

  /**
   * Locate an `Environment` inside any env-folder of the open project
   * by its id. Searches recursively through `subEnvironments` so nested
   * envs (e.g. `prod → eu-west`) are reachable. Returns `null` when no
   * environment with the given id exists in the project.
   */
  const findEnvById = (envId: string): Environment | null => {
    const root = collectionStore
    const walkEnv = (env: Environment): Environment | null => {
      if (env.id === envId) return env
      for (const sub of env.subEnvironments ?? []) {
        const hit = walkEnv(sub)
        if (hit) return hit
      }
      return null
    }
    for (const folder of root.getCollections()) {
      if (!isEnvironmentFolder(folder)) continue
      for (const env of folder.environments) {
        const hit = walkEnv(env)
        if (hit) return hit
      }
    }
    return null
  }

  mcp.registerTool(
    'list_env_variables',
    {
      titleKey: 'mcpToolTitles.listEnvVariables',
      title: 'List variables of an environment',
      description:
        'Return every key + serialised value for the given `Environment`. Use this to discover ' +
        'what variables an env folder ships with (e.g. after `import_from_url` auto-creates ' +
        '`baseUrl` / `JWTBearer_token` for an OpenAPI spec with bearer security). ' +
        'Returned `value` is the persisted ValueType POJO — for `password`-typed entries the ' +
        '`value.value` field is the plaintext currently held in memory (which is what the ' +
        'request resolver uses); the on-disk shape strips it via `.env`.',
      inputSchema: {
        envId: z.string().min(1).describe('Environment id (NOT the env-folder id). Find it via `list_folders` then read the folder\'s `environments[i].id`.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const envId = typeof argRecord['envId'] === 'string' ? argRecord['envId'] : ''
      if (!envId) return errorReply('envId is required')
      const env = findEnvById(envId)
      if (!env) return errorReply(`No environment with id ${envId}`)
      const variables = env.variables.map((kv) => ({
        id: kv.id,
        key: kv.key,
        enabled: kv.enabled,
        description: kv.description,
        value: kv.value
      }))
      return jsonReply({ envId, name: env.name, variables })
    }
  )

  mcp.registerTool(
    'set_env_variable',
    {
      titleKey: 'mcpToolTitles.setEnvVariable',
      title: 'Create or update one environment variable',
      description:
        'Upsert a single variable on the given `Environment`. If a variable with the same key ' +
        'already exists it is replaced (keeping its id), otherwise a new one is appended. The ' +
        '`value` field accepts the persisted `ValueType` POJO shape: ' +
        '`{ type: "string" | "expression" | "numeric" | "boolean" | "color" | "datetime", value: ... }`. ' +
        'For `secret` variables, use `{ type: "secret", source: "<sourceId>", params: { … } }`; the ' +
        'plaintext is resolved in the main process at run time and is never persisted or returned. ' +
        'Use `expression` (not `string`) when the value contains `{{handlebars}}` placeholders that ' +
        'should resolve against this environment\'s context — `StringValue` ships verbatim. ' +
        'Triggers an autosave so the change persists immediately.',
      inputSchema: {
        envId: z.string().min(1).describe('Environment id.'),
        key: z.string().min(1).describe('Variable key (e.g. "JWTBearer_token").'),
        value: z
          .record(z.string(), z.unknown())
          .describe('Persisted `ValueType` POJO, e.g. `{ "type": "secret", "source": "envVar", "params": { "name": "API_TOKEN" } }` or `{ "type": "expression", "value": "Bearer {{token}}" }`. A bare string is rejected — wrap plain text in `{ "type": "string", "value": "…" }`.'),
        enabled: z.boolean().optional().describe('Default true.'),
        description: z.string().optional().describe('Free-text description shown next to the variable.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const envId = typeof argRecord['envId'] === 'string' ? argRecord['envId'] : ''
      const key = typeof argRecord['key'] === 'string' ? argRecord['key'] : ''
      if (!envId) return errorReply('envId is required')
      if (!key) return errorReply('key is required')
      const env = findEnvById(envId)
      if (!env) return errorReply(`No environment with id ${envId}`)
      const enabled = typeof argRecord['enabled'] === 'boolean' ? argRecord['enabled'] : true
      const description = typeof argRecord['description'] === 'string' ? argRecord['description'] : undefined
      const valueRaw = argRecord['value']
      const secretError = validateSecretValue(valueRaw)
      if (secretError !== null) return errorReply(secretError)
      // KeyValue.fromPlain handles every ValueType shape + falls back to
      // a sensible empty StringValue when the caller omits `value`.
      const kv = KeyValue.fromPlain({
        key,
        value: valueRaw,
        ...(description !== undefined ? { description } : {}),
        enabled
      })
      const existingIdx = env.variables.findIndex((v) => v.key === key)
      if (existingIdx >= 0) {
        // Preserve the prior id so per-variable subscribers (transform
        // result store, search index) don't see a "deleted then
        // created" diff for an update.
        const existing = env.variables[existingIdx]
        if (existing?.id !== undefined) kv.id = existing.id
        env.variables[existingIdx] = kv
      } else {
        env.variables.push(kv)
      }
      // Find the owning env-folder so we can re-broadcast it to the
      // renderer; the env document itself isn't a top-level save unit,
      // it travels inside the env folder.
      const ownerFolderId = ((): string | undefined => {
        const isOwnedBy = (root: Environment): boolean => {
          if (root === env) return true
          for (const sub of root.subEnvironments ?? []) {
            if (isOwnedBy(sub)) return true
          }
          return false
        }
        for (const folder of collectionStore.getCollections()) {
          if (!isEnvironmentFolder(folder)) continue
          for (const e of folder.environments) {
            if (isOwnedBy(e)) return folder.id
          }
        }
        return undefined
      })()
      // Notify ContextService that this env's variables changed so the
      // handlebars context is rebuilt. `updateFolder({})` with an empty
      // patch wouldn't pass the `patchTouchesEnvironments` gate inside
      // CollectionStore, so the per-env `ENVIRONMENT_UPDATED` event
      // would never fire and the resolved URLs / available variables
      // would keep using the previous env snapshot.
      collectionStore.updateEnvironment(envId, {})
      if (ownerFolderId !== undefined) {
        collectionStore.updateFolder(ownerFolderId, {} as never)
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('mcp:folder-updated', { itemId: ownerFolderId, patch: {} })
          }
        }
      }
      broadcastTreeReplace()
      triggerSave()
      const declaredType = (valueRaw && typeof valueRaw === 'object' ? (valueRaw as { type?: unknown }).type : undefined)
      return jsonReply({ envId, key, replaced: existingIdx >= 0, type: typeof declaredType === 'string' ? declaredType : 'string' })
    }
  )

  mcp.registerTool(
    'delete_env_variable',
    {
      titleKey: 'mcpToolTitles.deleteEnvVariable',
      title: 'Delete one environment variable',
      description:
        'Remove a variable by key from the given `Environment`. No-op when the key isn\'t present ' +
        '(returns `removed: false` so the caller can branch). Triggers an autosave on success.',
      inputSchema: {
        envId: z.string().min(1).describe('Environment id.'),
        key: z.string().min(1).describe('Variable key to remove.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const envId = typeof argRecord['envId'] === 'string' ? argRecord['envId'] : ''
      const key = typeof argRecord['key'] === 'string' ? argRecord['key'] : ''
      if (!envId) return errorReply('envId is required')
      if (!key) return errorReply('key is required')
      const env = findEnvById(envId)
      if (!env) return errorReply(`No environment with id ${envId}`)
      const before = env.variables.length
      env.variables = env.variables.filter((v) => v.key !== key)
      const removed = env.variables.length < before
      if (removed) {
        // Same reason as set_env_variable: signal ContextService that
        // env.variables changed so the handlebars context is rebuilt.
        collectionStore.updateEnvironment(envId, {})
        broadcastTreeReplace()
        triggerSave()
      }
      return jsonReply({ envId, key, removed })
    }
  )

  // ────────────────────────────────────────────────────────────────────
  // Environments + sub-environments (structure CRUD). Variables are handled
  // by set/delete/list_env_variable above; these manage the environment NODES
  // themselves, symmetric to the env-folder UI. Sub-environments live embedded
  // in their parent env's content (not their own save unit), so every change
  // routes through `collectionStore` (which emits the env events ContextService
  // needs) plus a folder refresh + autosave.
  // ────────────────────────────────────────────────────────────────────

  /** Owner env-folder id of an environment (top-level or nested), or undefined. */
  const ownerEnvFolderId = (envId: string): string | undefined => {
    const contains = (e: Environment): boolean =>
      e.id === envId || (e.subEnvironments?.some(contains) ?? false)
    for (const folder of collectionStore.getCollections()) {
      if (!isEnvironmentFolder(folder)) continue
      if (folder.environments.some(contains)) return folder.id
    }
    return undefined
  }

  /** Persist + refresh the renderer after an environment-structure change. */
  const refreshEnvFolderAndSave = (folderId: string): void => {
    collectionStore.updateFolder(folderId, {} as never)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mcp:folder-updated', { itemId: folderId, patch: {} })
      }
    }
    broadcastTreeReplace()
    triggerSave()
  }

  mcp.registerTool(
    'list_environments',
    {
      titleKey: 'mcpToolTitles.listEnvironments',
      title: 'List the environments of an env-folder',
      description:
        'Return the environment tree of an env-folder: every top-level environment with its ' +
        'nested `subEnvironments`, each as `{ id, name, subEnvironments? }`. Use the returned ' +
        'ids with `set_env_variable` / `rename_environment` / `delete_environment` and as ' +
        '`parentEnvironmentId` for `create_environment`.',
      inputSchema: {
        envFolderId: z.string().min(1).describe('Env-folder id (from `list_folders`, `kind: "env-folder"`).')
      } as Record<string, unknown>
    },
    (args) => {
      const folderId = typeof args['envFolderId'] === 'string' ? args['envFolderId'] : ''
      if (!folderId) return errorReply('envFolderId is required')
      const folder = collectionStore.findById(folderId)
      if (!folder || !isEnvironmentFolder(folder)) return errorReply(`No env-folder with id ${folderId}`)
      const mapEnv = (e: Environment): Record<string, unknown> => ({
        id: e.id,
        name: e.name,
        ...(e.subEnvironments && e.subEnvironments.length > 0
          ? { subEnvironments: e.subEnvironments.map(mapEnv) }
          : {})
      })
      return jsonReply({ envFolderId: folderId, environments: folder.environments.map(mapEnv) })
    }
  )

  mcp.registerTool(
    'create_environment',
    {
      titleKey: 'mcpToolTitles.createEnvironment',
      title: 'Create an environment or sub-environment',
      description:
        'Add a new environment to an env-folder. Omit `parentEnvironmentId` for a top-level ' +
        'environment, or pass an existing environment id to nest the new one as its ' +
        'sub-environment. The new environment starts with no variables — populate it with ' +
        '`set_env_variable`. Triggers an autosave.',
      inputSchema: {
        envFolderId: z.string().min(1).describe('Env-folder id (from `list_folders`).'),
        name: z.string().min(1).optional().describe('Environment name. Defaults to "New environment".'),
        parentEnvironmentId: z.string().min(1).optional().describe('When set, create the env as a sub-environment of this environment (must live in the same env-folder).')
      } as Record<string, unknown>
    },
    (args) => {
      const folderId = typeof args['envFolderId'] === 'string' ? args['envFolderId'] : ''
      if (!folderId) return errorReply('envFolderId is required')
      const folder = collectionStore.findById(folderId)
      if (!folder || !isEnvironmentFolder(folder)) return errorReply(`No env-folder with id ${folderId}`)
      const name = typeof args['name'] === 'string' && args['name'].length > 0 ? args['name'] : 'New environment'
      const parentEnvironmentId = typeof args['parentEnvironmentId'] === 'string' ? args['parentEnvironmentId'] : undefined
      if (parentEnvironmentId !== undefined && ownerEnvFolderId(parentEnvironmentId) !== folderId) {
        return errorReply(`parentEnvironmentId ${parentEnvironmentId} is not an environment of env-folder ${folderId}`)
      }
      const env = collectionStore.createEnvironment(folderId, { name }, parentEnvironmentId)
      refreshEnvFolderAndSave(folderId)
      return jsonReply({ id: env.id, name: env.name, envFolderId: folderId, ...(parentEnvironmentId !== undefined ? { parentEnvironmentId } : {}) })
    }
  )

  mcp.registerTool(
    'rename_environment',
    {
      titleKey: 'mcpToolTitles.renameEnvironment',
      title: 'Rename an environment',
      description: 'Rename an environment or sub-environment by id. Triggers an autosave.',
      inputSchema: {
        envId: z.string().min(1).describe('Environment id (from `list_environments`).'),
        name: z.string().min(1).describe('New name.')
      } as Record<string, unknown>
    },
    (args) => {
      const envId = typeof args['envId'] === 'string' ? args['envId'] : ''
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!envId) return errorReply('envId is required')
      if (!name) return errorReply('name is required')
      if (!findEnvById(envId)) return errorReply(`No environment with id ${envId}`)
      collectionStore.updateEnvironment(envId, { name })
      const folderId = ownerEnvFolderId(envId)
      if (folderId !== undefined) refreshEnvFolderAndSave(folderId)
      return jsonReply({ envId, name })
    }
  )

  mcp.registerTool(
    'delete_environment',
    {
      titleKey: 'mcpToolTitles.deleteEnvironment',
      title: 'Delete an environment or sub-environment',
      description:
        'Remove an environment (and, recursively, its sub-environments) by id. Returns ' +
        '`removed: false` when the id isn\'t found. Triggers an autosave on success.',
      inputSchema: {
        envId: z.string().min(1).describe('Environment id (from `list_environments`).')
      } as Record<string, unknown>
    },
    (args) => {
      const envId = typeof args['envId'] === 'string' ? args['envId'] : ''
      if (!envId) return errorReply('envId is required')
      // Capture the owner folder BEFORE deletion — afterwards the env is gone.
      const folderId = ownerEnvFolderId(envId)
      const removed = collectionStore.deleteEnvironment(envId)
      if (removed && folderId !== undefined) refreshEnvFolderAndSave(folderId)
      return jsonReply({ envId, removed })
    }
  )

  mcp.registerTool(
    'refresh_environment',
    {
      titleKey: 'mcpToolTitles.refreshEnvironment',
      title: 'Re-resolve an environment\'s secret variables',
      description:
        'Force a re-resolution of every secret variable the environment OWNS: drops the ' +
        'resolution cache, blanks the resolved plaintext, and re-fetches from each provider — ' +
        'the env-level equivalent of the per-secret refresh button. The resolved values + any ' +
        'expression composing them update live in the app; nothing is written to disk (resolved ' +
        'plaintext is never persisted). Resolution is async (a slow provider keeps the spinner ' +
        'up), so this returns immediately with the count of secrets it kicked off.',
      inputSchema: {
        envId: z.string().min(1).describe('Environment id (from `list_environments`). Sub-environments are supported.')
      } as Record<string, unknown>
    },
    (args) => {
      const envId = typeof args['envId'] === 'string' ? args['envId'] : ''
      if (!envId) return errorReply('envId is required')
      if (!findEnvById(envId)) return errorReply(`No environment with id ${envId}`)
      const secretsRefreshed = contextService.refreshEnvironmentSecrets(envId)
      return jsonReply({ envId, secretsRefreshed })
    }
  )

  // ────────────────────────────────────────────────────────────────────
  // Custom value lists — user-defined label → value maps on an env
  // folder ("Variables personnalisées"). Selectable as a value type in
  // any key-value table; at dispatch the resolver substitutes the
  // matching entry's value for the selected label.
  // ────────────────────────────────────────────────────────────────────

  const findEnvFolderById = (folderId: string): EnvironmentFolder | null => {
    const item = collectionStore.findById(folderId)
    return item && isEnvironmentFolder(item) ? (item as unknown as EnvironmentFolder) : null
  }

  const persistCustomValueLists = (folder: EnvironmentFolder, next: CustomValueList[]): void => {
    folder.customValueLists = next
    collectionStore.updateFolder(folder.id, { customValueLists: next } as never)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mcp:folder-updated', { itemId: folder.id, patch: { customValueLists: next } })
      }
    }
    broadcastTreeReplace()
    triggerSave()
  }

  const coerceEntries = (raw: unknown): CustomValueEntry[] => {
    if (!Array.isArray(raw)) return []
    return raw
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map((e) => ({
        id: typeof e['id'] === 'string' && e['id'] ? (e['id']) : crypto.randomUUID(),
        label: typeof e['label'] === 'string' ? (e['label']) : '',
        value: typeof e['value'] === 'string' ? (e['value']) : '',
        ...(e['enabled'] === false ? { enabled: false } : {})
      }))
  }

  const entriesSchema = z
    .array(z.object({ id: z.string().optional(), label: z.string(), value: z.string(), enabled: z.boolean().optional() }))
    .describe('Entries: `[{ "label": "Rouge", "value": "FF0000" }, …]`. `id` optional (auto-generated). `enabled: false` hides the entry from the dropdown + makes it unresolvable.')

  mcp.registerTool(
    'list_custom_value_lists',
    {
      titleKey: 'mcpToolTitles.listCustomValueLists',
      title: 'List the custom value lists of an env folder',
      description:
        'Return every user-defined custom value list (label → value maps) on the given environment ' +
        'folder. These are selectable as a "custom type" in any key-value table; at dispatch the ' +
        'selected label is replaced by the matching entry value.',
      inputSchema: {
        folderId: z.string().min(1).describe('Environment-folder id (from `list_folders`, kind "env-folder").')
      } as Record<string, unknown>
    },
    (args) => {
      const folderId = typeof args['folderId'] === 'string' ? args['folderId'] : ''
      if (!folderId) return errorReply('folderId is required')
      const folder = findEnvFolderById(folderId)
      if (!folder) return errorReply(`No environment folder with id ${folderId}`)
      return jsonReply({ folderId, lists: folder.customValueLists ?? [] })
    }
  )

  mcp.registerTool(
    'create_custom_value_list',
    {
      titleKey: 'mcpToolTitles.createCustomValueList',
      title: 'Create a custom value list',
      description:
        'Append a new named custom value list to the env folder. Example: name "Couleur" with ' +
        'entries `[{ "label": "Rouge", "value": "FF0000" }, { "label": "Vert", "value": "00FF00" }]`. ' +
        'Returns the created list (with generated ids). Triggers an autosave.',
      inputSchema: {
        folderId: z.string().min(1).describe('Environment-folder id.'),
        name: z.string().min(1).describe('Display name (e.g. "Couleur").'),
        entries: entriesSchema.optional()
      } as Record<string, unknown>
    },
    (args) => {
      const folderId = typeof args['folderId'] === 'string' ? args['folderId'] : ''
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!folderId) return errorReply('folderId is required')
      if (!name) return errorReply('name is required')
      const folder = findEnvFolderById(folderId)
      if (!folder) return errorReply(`No environment folder with id ${folderId}`)
      const list: CustomValueList = { id: crypto.randomUUID(), name, entries: coerceEntries(args['entries']) }
      persistCustomValueLists(folder, [...(folder.customValueLists ?? []), list])
      return jsonReply({ folderId, list })
    }
  )

  mcp.registerTool(
    'update_custom_value_list',
    {
      titleKey: 'mcpToolTitles.updateCustomValueList',
      title: 'Update a custom value list',
      description:
        'Rename a custom value list and/or replace its entries. Omit `name` to keep the current ' +
        'name; omit `entries` to keep the current entries (pass `[]` to clear them). The full ' +
        'entries array replaces the existing one. Triggers an autosave.',
      inputSchema: {
        folderId: z.string().min(1).describe('Environment-folder id.'),
        listId: z.string().min(1).describe('Custom value list id.'),
        name: z.string().optional().describe('New display name (optional).'),
        entries: entriesSchema.optional().describe('Replacement entries (optional; pass `[]` to clear).')
      } as Record<string, unknown>
    },
    (args) => {
      const folderId = typeof args['folderId'] === 'string' ? args['folderId'] : ''
      const listId = typeof args['listId'] === 'string' ? args['listId'] : ''
      if (!folderId) return errorReply('folderId is required')
      if (!listId) return errorReply('listId is required')
      const folder = findEnvFolderById(folderId)
      if (!folder) return errorReply(`No environment folder with id ${folderId}`)
      const lists = folder.customValueLists ?? []
      const current = lists.find((l) => l.id === listId)
      if (!current) return errorReply(`No custom value list with id ${listId}`)
      const updated: CustomValueList = {
        ...current,
        ...(typeof args['name'] === 'string' && args['name'] ? { name: args['name'] } : {}),
        ...(args['entries'] !== undefined ? { entries: coerceEntries(args['entries']) } : {})
      }
      const next = lists.map((l) => (l.id === listId ? updated : l))
      persistCustomValueLists(folder, next)
      return jsonReply({ folderId, list: updated })
    }
  )

  mcp.registerTool(
    'delete_custom_value_list',
    {
      titleKey: 'mcpToolTitles.deleteCustomValueList',
      title: 'Delete a custom value list',
      description:
        'Remove a custom value list from the env folder by id. Returns `removed: false` when the ' +
        'id is not present. Triggers an autosave on success.',
      inputSchema: {
        folderId: z.string().min(1).describe('Environment-folder id.'),
        listId: z.string().min(1).describe('Custom value list id to remove.')
      } as Record<string, unknown>
    },
    (args) => {
      const folderId = typeof args['folderId'] === 'string' ? args['folderId'] : ''
      const listId = typeof args['listId'] === 'string' ? args['listId'] : ''
      if (!folderId) return errorReply('folderId is required')
      if (!listId) return errorReply('listId is required')
      const folder = findEnvFolderById(folderId)
      if (!folder) return errorReply(`No environment folder with id ${folderId}`)
      const lists = folder.customValueLists ?? []
      const next = lists.filter((l) => l.id !== listId)
      const removed = next.length < lists.length
      if (removed) persistCustomValueLists(folder, next)
      return jsonReply({ folderId, listId, removed })
    }
  )
}

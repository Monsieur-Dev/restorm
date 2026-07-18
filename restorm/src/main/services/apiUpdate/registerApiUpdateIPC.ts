import { createHash } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { logger, validatedHandle } from 'electron-core-ui'
import { broadcastTreeReplace } from '../../mcp/tools/import'
import {
  apiUpdateSetSettingsArgs,
  apiUpdateApplyArgs,
  apiUpdateRefreshFetchArgs,
  collectionsSyncArgs,
  collectionsUpdateFolderCustomValueListsArgs
} from '../../ipc/schemas'
import { collectionStore } from '../CollectionStore'
import { contextService } from '../ContextService'
import { resolveAuthHeadersForFolder } from './resolveAuthHeaders'
import { detectFormat, importFromContent } from '../import/ImportManager'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { isEnvironmentFolder } from '../../../shared/types/folderTypes'
import { assertSafeFetchUrl } from '../../utils/urlSecurity'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import type { ApiUpdateConfig } from '../../../shared/types/baseTypes'

/**
 * Wire the on-demand API spec refresh flow into the IPC bus.
 *
 * Surface:
 *
 * - `apiUpdate:set-settings` — persist a partial `ApiUpdateConfig`
 *   patch on the folder (sourceUrl, sourceHeaders, lastCheckedAt,
 *   lastImportedAt, payloadChecksum, authenticationRequestId).
 * - `apiUpdate:apply` — re-import the folder's spec end-to-end and
 *   run the idempotent merge pipeline. Used by the import wizard's
 *   "Apply update" button after a refresh mismatch.
 * - `apiUpdate:refresh-fetch` — fetch the source URL once, with the
 *   folder's `${VAR}`-expanded headers + the resolved auth headers,
 *   and return the body + a structural checksum. The renderer
 *   compares the checksum against the stored one to decide whether
 *   to open the Import modal in refresh mode.
 */
export interface ApiUpdateIPCDeps {
  /** Mutate the persisted `apiUpdate` config for a folder. The main
   * process owns the source of truth (CollectionStore) so the IPC
   * handler stays a thin shim — the host wires this to `updateFolder`
   * + a persistence flush. */
  updateFolderConfig: (folderId: string, patch: Partial<ApiUpdateConfig>) => void
  /** Apply an available update against the folder. Resolves once the
   * pipeline has run + persisted; rejects on error so the renderer
   * can surface a toast. The optional `selection` payload lets the
   * wizard restrict the apply to the user's resolved choice — only
   * the listed natural keys make it into the pipeline. */
  applyUpdate: (folderId: string, selection?: { include: string[]; skip: string[] }) => Promise<{ updatedFolder: unknown }>
}

/** Plain string extractor for `${VAR}` expansion — the same shape
 * `defaultVariablesFor` uses in `orchestrateApply.ts`. */
function extractStringValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object') {
    const obj = v as { value?: unknown; toString?: () => string }
    if (typeof obj.value === 'string') return obj.value
    if (typeof obj.value === 'number' || typeof obj.value === 'boolean') return String(obj.value)
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const out = obj.toString()
      if (out !== '[object Object]') return out
    }
  }
  return undefined
}

function defaultVariablesFor(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const vars: Record<string, string> = {}
  for (const kv of env.variables) {
    const v = extractStringValue(kv.value)
    if (v !== undefined) vars[kv.key] = v
  }
  return vars
}

/** Expand `${VAR}` placeholders against the env-var map. Unknown
 * names are left intact so the user can spot misconfigured templates
 * in the eventual fetch URL. */
function expandVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, name: string) => vars[name] ?? match)
}

function expandHeaderTemplate(
  headers: Record<string, string> | undefined,
  vars: Record<string, string>
): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) out[k] = expandVariables(v, vars)
  return out
}

export function registerApiUpdateIPC(deps: ApiUpdateIPCDeps): void {
  validatedHandle('apiUpdate:set-settings', apiUpdateSetSettingsArgs, (_event, [folderId, config]) => {
    deps.updateFolderConfig(folderId, config)
    logger.info(`[apiUpdate.IPC] settings updated for folder ${folderId}`)
  })

  validatedHandle('apiUpdate:apply', apiUpdateApplyArgs, async (_event, [folderId, selection]) => {
    return await deps.applyUpdate(folderId, selection)
  })

  validatedHandle(
    'apiUpdate:refresh-fetch',
    apiUpdateRefreshFetchArgs,
    async (_event, [folderId]): Promise<
      | { ok: true; checksum: string; payload: string; items: FolderItem[]; format: string | null }
      | { ok: false; error: string }
    > => {
      const target = collectionStore.findById(folderId)
      if (!target || !('folderType' in target)) {
        return { ok: false, error: `Folder ${folderId} not found` }
      }
      const env = target as unknown as EnvironmentFolder
      const config = (env as unknown as { apiUpdate?: ApiUpdateConfig }).apiUpdate
      if (!config?.sourceUrl) {
        return { ok: false, error: `Folder ${folderId} has no apiUpdate.sourceUrl` }
      }
      try {
        const variables = defaultVariablesFor(env)
        const url = expandVariables(config.sourceUrl, variables)
        const staticHeaders = expandHeaderTemplate(config.sourceHeaders, variables)
        // `resolveAuthHeadersForFolder` runs the attached auth route
        // through the same engine the request-tab "Send" uses, which
        // does the `{{var}}` expansion via the env folder's
        // ContextService. Renderer-side `auth.prefetch` would only
        // forward the raw, unexpanded request — so refresh must
        // resolve auth here, not in the renderer.
        const dynamicHeaders = await resolveAuthHeadersForFolder(env, config.authenticationRequestId, variables)
        const headers = { ...dynamicHeaders, ...staticHeaders }
        // SSRF guard: the spec URL is the stored, user-supplied import
        // source — the same EXPLICIT top-level URL the initial import
        // used, so loopback/private hosts (a local dev API server) are a
        // legitimate refresh target and opt in via `allowPrivateHosts`.
        // Link-local / cloud-metadata stays blocked; this fetch is not
        // firewall-gated.
        assertSafeFetchUrl(url, { allowPrivateHosts: true })
        const response = await fetch(url, Object.keys(headers).length === 0 ? {} : { headers })
        if (!response.ok) {
          return { ok: false, error: `HTTP ${String(response.status)}: ${response.statusText}` }
        }
        const payload = await response.text()
        const checksum = `sha256:${createHash('sha256').update(payload).digest('hex')}`
        // Parse the fetched payload so the renderer's refresh modal
        // has the same items the Apply path will produce — running
        // detectFormat + importFromContent here keeps the auth +
        // var-expansion path consolidated on main (the renderer
        // would otherwise have to recreate them just to call
        // `import.preview`).
        const format = detectFormat(payload, url)
        let items: FolderItem[] = []
        if (format) {
          const result = await importFromContent(payload, format, url, url)
          if (result.success) items = result.items as FolderItem[]
        }
        return { ok: true, checksum, payload, items, format: format ?? null }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[apiUpdate.refresh-fetch] failed', { folderId, error: message })
        return { ok: false, error: message }
      }
    }
  )

  validatedHandle('collections:sync', collectionsSyncArgs, (_event, [collections, mcpVersion]) => {
    const applied = collectionStore.setCollections(
      collections as Parameters<typeof collectionStore.setCollections>[0],
      'user',
      mcpVersion
    )
    if (!applied) {
      // The mirror predated an MCP mutation the renderer hasn't applied yet, so
      // the authoritative tree was kept. Re-broadcast it (no version bump) so
      // the renderer swaps its stale rootItems back to authoritative, then
      // re-trigger the autosave so the corrected tree — not the stale one —
      // reaches disk. This is what makes an MCP write tool's return guarantee
      // its mutation survives the next autosave.
      broadcastTreeReplace({ bumpVersion: false })
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('file:autosave-trigger')
      }
      logger.warn('[apiUpdate.collections:sync] refused stale renderer mirror; re-broadcast authoritative tree', {
        mcpVersion,
        modelVersion: collectionStore.getModelVersion()
      })
      return
    }
    logger.info('[apiUpdate.collections:sync] mirrored collections from renderer', { count: collections.length })
  })

  // Targeted folder update for custom value lists. Sets the lists on the
  // folder directly (NOT via `updateFolder`, whose `FOLDER_UPDATED` /
  // `ENVIRONMENT_UPDATED` GraphQL publishes would spam the subscription
  // layer on every keystroke), then asks ContextService to re-resolve
  // the folder's open requests + env contexts against the fresh lists.
  // Disk persistence stays renderer-driven.
  validatedHandle('collections:update-folder-custom-value-lists', collectionsUpdateFolderCustomValueListsArgs, (_event, [folderId, lists]) => {
    const folder = collectionStore.findById(folderId)
    if (folder && isEnvironmentFolder(folder)) {
      folder.customValueLists = lists as EnvironmentFolder['customValueLists']
      contextService.recalculateForCustomListChange(folderId)
      logger.info('[apiUpdate.update-folder-custom-value-lists] updated folder lists', { folderId, count: lists.length })
    }
  })
}

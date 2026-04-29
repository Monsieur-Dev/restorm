import { BrowserWindow, ipcMain } from 'electron'
import { logger, validatedHandle } from 'electron-core-ui'
import {
  apiUpdateGetStateArgs,
  apiUpdateGetSnapshotArgs,
  apiUpdateSetSettingsArgs,
  apiUpdateCheckNowArgs,
  apiUpdateApplyArgs,
  apiUpdateDismissArgs
} from '../../ipc/schemas'
import { apiUpdateStateStore } from './ApiUpdateStateStore'
import { apiUpdateScheduler } from './ApiUpdateScheduler'
import type { ApiUpdateConfig } from '../../../shared/types/baseTypes'

const STATE_CHANGED_CHANNEL = 'apiUpdate:state-changed'

/**
 * Wire the API-update orchestration into the IPC bus.
 *
 * Three concerns live here:
 *
 * 1. Read access: `getState` / `getSnapshot` for the renderer's
 *    initial sync.
 * 2. Mutations: `setSettings` / `checkNow` / `apply` / `dismiss`.
 *    Mutations that change persisted config delegate to a host hook
 *    so the main process can flush the change through the
 *    CollectionStore + persistence pipeline.
 * 3. Push channel: every state-store transition is broadcast on
 *    `apiUpdate:state-changed`. The renderer subscribes once and
 *    keeps every badge / toast in sync off the same stream.
 */
export interface ApiUpdateIPCDeps {
  /** Mutate the persisted `apiUpdate` config for a folder. The main
   * process owns the source of truth (CollectionStore) so the IPC
   * handler stays a thin shim — the host wires this to `updateFolder`
   * + a persistence flush. */
  updateFolderConfig: (folderId: string, patch: Partial<ApiUpdateConfig>) => void
  /** Apply an available update against the folder. Resolves once the
   * pipeline has run + persisted; rejects on error so the renderer
   * can surface a toast. */
  applyUpdate: (folderId: string) => Promise<void>
}

let dismissed = new Set<string>()

export function registerApiUpdateIPC(deps: ApiUpdateIPCDeps): void {
  // Push every state transition to every BrowserWindow. We use
  // ipcMain.on / webContents.send rather than the GraphQL pubsub
  // because the renderer doesn't subscribe via Apollo here — the
  // hook lives in plain React state.
  apiUpdateStateStore.subscribe((folderId, state) => {
    if (folderId === '*') return
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(STATE_CHANGED_CHANNEL, { folderId, state })
    }
  })

  validatedHandle('apiUpdate:get-state', apiUpdateGetStateArgs, (_event, [folderId]) => {
    return apiUpdateStateStore.get(folderId)
  })

  validatedHandle('apiUpdate:get-snapshot', apiUpdateGetSnapshotArgs, () => {
    return apiUpdateStateStore.snapshot()
  })

  validatedHandle('apiUpdate:set-settings', apiUpdateSetSettingsArgs, (_event, [folderId, config]) => {
    deps.updateFolderConfig(folderId, config)
    logger.info(`[apiUpdate.IPC] settings updated for folder ${folderId}`)
  })

  validatedHandle('apiUpdate:check-now', apiUpdateCheckNowArgs, async (_event, [folderId]) => {
    await apiUpdateScheduler.checkNow(folderId)
  })

  validatedHandle('apiUpdate:apply', apiUpdateApplyArgs, async (_event, [folderId]) => {
    apiUpdateStateStore.patch(folderId, { kind: 'applying' })
    try {
      await deps.applyUpdate(folderId)
      apiUpdateStateStore.patch(folderId, { kind: 'idle', error: undefined })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      apiUpdateStateStore.patch(folderId, { kind: 'error', error: message })
      throw err
    }
  })

  validatedHandle('apiUpdate:dismiss', apiUpdateDismissArgs, (_event, [folderId]) => {
    // Session-only dismissal: do NOT clear the state, just remember
    // that the user said "not now" so toasts don't re-pop on the
    // next state-changed echo. The available state itself remains
    // — the badge in the sidebar still shows.
    dismissed.add(folderId)
  })

  // Reset session-dismissals when the project file closes.
  ipcMain.on('apiUpdate:reset-dismissed', () => {
    dismissed = new Set()
  })
}

export function isDismissedThisSession(folderId: string): boolean {
  return dismissed.has(folderId)
}

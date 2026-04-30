import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import { settingsGetArgs, settingsSetArgs, settingsSearchArgs, settingsResetArgs } from '../../ipc/schemas'
import { isSettingsServiceInitialized, getSettingsService } from '../../services'

export function registerSettingsHandlers(): void {
  validatedHandle('settings:get', settingsGetArgs, (_event, [storageKey]) => {
    if (!isSettingsServiceInitialized()) return null
    return getSettingsService().get(storageKey)
  })

  validatedHandle('settings:set', settingsSetArgs, (_event, [storageKey, value]) => {
    if (!isSettingsServiceInitialized()) return false
    getSettingsService().set(storageKey, value)
    return true
  })

  ipcMain.handle('settings:get-all', () => {
    if (!isSettingsServiceInitialized()) return []
    return getSettingsService().getAll()
  })

  ipcMain.handle('settings:get-groups', () => {
    if (!isSettingsServiceInitialized()) return []
    return getSettingsService().getFilteredGroups()
  })

  validatedHandle('settings:search', settingsSearchArgs, (_event, [query]) => {
    if (!isSettingsServiceInitialized()) return []
    return getSettingsService().search(query)
  })

  validatedHandle('settings:reset', settingsResetArgs, (_event, [storageKey]) => {
    if (!isSettingsServiceInitialized()) return false
    getSettingsService().resetSetting(storageKey)
    return true
  })

  ipcMain.handle('settings:reindex', () => {
    if (!isSettingsServiceInitialized()) return
    getSettingsService().reindexSearch()
  })

  // ── Workspace overlay ──────────────────────────────────────────────
  ipcMain.handle('settings:get-workspace-path', () => {
    if (!isSettingsServiceInitialized()) return null
    return getSettingsService().getWorkspacePath()
  })

  ipcMain.handle('settings:get-workspace-values', () => {
    if (!isSettingsServiceInitialized()) return {}
    return getSettingsService().getWorkspaceValues()
  })

  validatedHandle('settings:get-workspace-value', settingsGetArgs, (_event, [storageKey]) => {
    if (!isSettingsServiceInitialized()) return null
    return getSettingsService().getWorkspaceValue(storageKey) ?? null
  })

  validatedHandle('settings:set-workspace-value', settingsSetArgs, (_event, [storageKey, value]) => {
    if (!isSettingsServiceInitialized()) return false
    getSettingsService().setWorkspaceValue(storageKey, value)
    return true
  })

  validatedHandle('settings:reset-workspace-value', settingsResetArgs, (_event, [storageKey]) => {
    if (!isSettingsServiceInitialized()) return false
    getSettingsService().resetWorkspaceValue(storageKey)
    return true
  })

  validatedHandle('settings:get-resolved-value', settingsGetArgs, (_event, [storageKey]) => {
    if (!isSettingsServiceInitialized()) return null
    return getSettingsService().getResolvedValue(storageKey)
  })
}

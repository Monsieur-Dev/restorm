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
}

/**
 * IPC handlers for the auto-update feature. Exposed to the renderer under
 * `window.api.update.*` (see preload). All args are zod-validated.
 */
import { validatedHandle } from 'electron-core-ui'
import { updateService } from '../services'
import { UPDATE_IPC } from '../../shared/update/updateTypes'
import {
  noArgs,
  updateChangelogSinceArgs,
  updateChangelogSinceLocaleArgs,
  updateSetAutoCheckArgs
} from './schemas'

export function registerUpdateIpc(): void {
  validatedHandle(UPDATE_IPC.GET_STATE, noArgs, () => updateService.getState())

  validatedHandle(UPDATE_IPC.GET_SETTINGS, noArgs, () => updateService.getSettings())

  validatedHandle(UPDATE_IPC.CHECK_NOW, noArgs, async () => {
    await updateService.checkForUpdates('manual')
    return updateService.getState()
  })

  validatedHandle(UPDATE_IPC.QUIT_AND_INSTALL, noArgs, () => {
    updateService.quitAndInstall()
  })

  validatedHandle(UPDATE_IPC.SET_AUTO_CHECK, updateSetAutoCheckArgs, (_event, [enabled]) => {
    updateService.setAutoCheckEnabled(enabled)
    return updateService.getSettings()
  })

  validatedHandle(
    UPDATE_IPC.GET_CHANGELOG_SINCE,
    updateChangelogSinceLocaleArgs,
    (_event, [fromVersion, locale]) => updateService.getChangelogSince(fromVersion, locale)
  )

  validatedHandle(UPDATE_IPC.GET_LAST_SEEN_VERSION, noArgs, () =>
    updateService.getLastSeenVersion()
  )

  validatedHandle(UPDATE_IPC.MARK_VERSION_SEEN, updateChangelogSinceArgs, (_event, [version]) => {
    updateService.markVersionSeen(version)
  })
}

import { ipcMain, BrowserWindow } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import { i18nSetLanguageArgs, loggerLogArgs, featureIsEnabledArgs, eventBusEmitArgs } from '../../ipc/schemas'
import { logger, i18nService, isFeatureServiceInitialized, getFeatureService, eventBusService, isSettingsServiceInitialized, getSettingsService } from '../../services'
import type { StorageService } from '../../services'

export function registerMiscHandlers(storageService: StorageService): void {
  // ========================================================================
  // I18n IPC handlers
  // ========================================================================
  validatedHandle('i18n:set-language', i18nSetLanguageArgs, (_event, [language]) => {
    // setLanguage already persists 'language' through StorageService, so the
    // handler must not also write it — a second set is a redundant disk write
    // (and a window where the two could diverge if either changed).
    const changed = i18nService.getLanguage() !== language
    i18nService.setLanguage(language)
    // The settings search index is built in main from `i18nService.t(titleKey)`,
    // so it goes stale the moment the active language moves. The renderer
    // reindexes on a language change it initiates, but it cannot see the one
    // that happens here on first boot — the renderer resolves the OS locale
    // itself and reports it back through this channel, which is a change from
    // main's point of view but not from the renderer's. Reindex on the
    // transition (never on a no-op re-report) so the index tracks the active
    // language for as long as `I18nService` has that language loaded (it
    // carries the built-in en/fr plus whatever the host added).
    if (changed && isSettingsServiceInitialized()) {
      getSettingsService().reindexSearch()
    }
    logger.debug('Language changed via IPC', { language })
    return true
  })

  ipcMain.handle('i18n:get-language', () => {
    // Only the EXPLICITLY persisted preference counts here — never fall
    // back to i18nService.getLanguage() (its own best-guess active
    // language). The renderer's initial-language resolution treats a
    // non-empty result as "the user chose this", so leaking main's guess
    // through this channel would look identical to an explicit choice and
    // permanently short-circuit the renderer's own OS-locale fallback.
    const stored = storageService.get('language') as string | undefined
    return stored ?? ''
  })

  // ========================================================================
  // Logger IPC handler
  // ========================================================================
  validatedHandle('logger:log', loggerLogArgs, (_event, [{ level, message, meta }]) => {
    switch (level) {
      case 'debug':
        logger.debug(message, meta)
        break
      case 'info':
        logger.info(message, meta)
        break
      case 'warn':
        logger.warn(message, meta)
        break
      case 'error':
        logger.error(message, meta)
        break
    }
  })

  // ========================================================================
  // Feature Flipping IPC handlers
  // ========================================================================
  validatedHandle('feature:is-enabled', featureIsEnabledArgs, (_event, [featureName]) => {
    if (!isFeatureServiceInitialized()) {
      logger.warn('Feature service not initialized, returning false for feature check', { featureName })
      return false
    }
    return getFeatureService().isEnabled(featureName)
  })

  ipcMain.handle('feature:get-platform', () => {
    if (!isFeatureServiceInitialized()) {
      logger.warn('Feature service not initialized, returning "desktop" as default platform')
      return 'desktop'
    }
    return getFeatureService().getPlatform()
  })

  ipcMain.handle('feature:get-environment', () => {
    if (!isFeatureServiceInitialized()) {
      logger.warn('Feature service not initialized, returning "prod" as default environment')
      return 'prod'
    }
    return getFeatureService().getEnvironment()
  })

  // Subscribe to feature service invalidations and push `feature:changed` to
  // every live renderer window.  This fires when the host app calls
  // `featureService.invalidate()` — e.g. after an entitlement refresh — so
  // renderer hooks that subscribed to `onChanged` can re-query `isEnabled`.
  if (isFeatureServiceInitialized()) {
    getFeatureService().subscribe(() => {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('feature:changed')
        }
      }
    })
  }

  // ========================================================================
  // EventBus IPC handlers
  // ========================================================================
  validatedHandle('eventbus:emit', eventBusEmitArgs, async (_event, [eventName, payload]) => {
    await eventBusService.emit(eventName, payload)
    return true
  })

  validatedHandle('eventbus:emit-sync', eventBusEmitArgs, (_event, [eventName, payload]) => {
    eventBusService.emitSync(eventName, payload)
    return true
  })
}

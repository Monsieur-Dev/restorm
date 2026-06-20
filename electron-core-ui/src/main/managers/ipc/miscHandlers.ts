import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import { i18nSetLanguageArgs, loggerLogArgs, featureIsEnabledArgs, eventBusEmitArgs } from '../../ipc/schemas'
import { logger, i18nService, isFeatureServiceInitialized, getFeatureService, eventBusService } from '../../services'
import type { StorageService } from '../../services'

export function registerMiscHandlers(storageService: StorageService): void {
  // ========================================================================
  // I18n IPC handlers
  // ========================================================================
  validatedHandle('i18n:set-language', i18nSetLanguageArgs, (_event, [language]) => {
    // setLanguage already persists 'language' through StorageService, so the
    // handler must not also write it — a second set is a redundant disk write
    // (and a window where the two could diverge if either changed).
    i18nService.setLanguage(language)
    logger.debug('Language changed via IPC', { language })
    return true
  })

  ipcMain.handle('i18n:get-language', () => {
    const stored = storageService.get('language') as string | undefined
    return stored ?? i18nService.getLanguage()
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

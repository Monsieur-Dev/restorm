import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import {
  fileOpenArgs, fileSaveArgs, fileSaveAsArgs,
  fileToggleFavoriteArgs, fileRemoveFromRecentArgs,
  fileChecksumArgs, fileShowUnsavedDialogArgs,
  fileRegisterChecksumsArgs, fileUpdateObjectChecksumArgs, fileRemoveObjectChecksumArgs
} from '../../ipc/schemas'
import { logger, isFileServiceInitialized, getFileService } from '../../services'

export function registerFileHandlers(): void {
  ipcMain.handle('file:new', async () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().newFile()
  })

  validatedHandle('file:open', fileOpenArgs, async (_event, [path]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return { success: false }
    }
    return getFileService().open(path)
  })

  validatedHandle('file:save', fileSaveArgs, async (_event, [content]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().save(content)
  })

  validatedHandle('file:save-as', fileSaveAsArgs, async (_event, [content, filename, format]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().saveAs(content, filename, format)
  })

  ipcMain.handle('file:close', () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().close()
  })

  ipcMain.handle('file:get-state', () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return null
    }
    return getFileService().getState()
  })

  ipcMain.handle('file:get-name', () => {
    if (!isFileServiceInitialized()) { return null }
    return getFileService().getFileName()
  })

  ipcMain.handle('file:get-path', () => {
    if (!isFileServiceInitialized()) { return null }
    return getFileService().getFilePath()
  })

  ipcMain.handle('file:is-dirty', () => {
    if (!isFileServiceInitialized()) { return false }
    return getFileService().isDirty()
  })

  ipcMain.handle('file:mark-dirty', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().markDirty()
  })

  ipcMain.handle('file:clear-dirty', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().clearDirty()
  })

  ipcMain.handle('file:finish-loading', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().finishLoading()
  })

  validatedHandle('file:check-and-update-dirty', fileChecksumArgs, (_event, [currentChecksum]) => {
    if (!isFileServiceInitialized()) { return }
    const fileService = getFileService()
    const hasChanges = fileService.hasContentChanged(currentChecksum)
    const isDirty = fileService.isDirty()

    if (hasChanges && !isDirty) {
      logger.debug('[FileService] Content changed, marking dirty')
      fileService.markDirty()
    } else if (!hasChanges && isDirty) {
      logger.debug('[FileService] Content returned to saved state, clearing dirty')
      fileService.clearDirty()
    }
  })

  validatedHandle('file:show-unsaved-dialog', fileShowUnsavedDialogArgs, async (_event, [labels]) => {
    if (!isFileServiceInitialized()) { return 'cancel' as const }
    return getFileService().showUnsavedChangesDialog(
      labels as { title?: string; message?: string; detail?: string; save?: string; dontSave?: string; cancel?: string } | undefined
    )
  })

  ipcMain.handle('file:get-recent', () => {
    if (!isFileServiceInitialized()) { return [] }
    return getFileService().getRecentFiles()
  })

  ipcMain.handle('file:get-favorites', () => {
    if (!isFileServiceInitialized()) { return [] }
    return getFileService().getFavorites()
  })

  validatedHandle('file:toggle-favorite', fileToggleFavoriteArgs, (_event, [path]) => {
    if (!isFileServiceInitialized()) { return false }
    return getFileService().toggleFavorite(path)
  })

  validatedHandle('file:remove-from-recent', fileRemoveFromRecentArgs, (_event, [path]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().removeFromRecent(path)
  })

  ipcMain.handle('file:get-content-checksum', () => {
    if (!isFileServiceInitialized()) { return null }
    return getFileService().getContentChecksum()
  })

  validatedHandle('file:set-content-checksum', fileChecksumArgs, (_event, [checksum]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().setContentChecksum(checksum)
  })

  validatedHandle('file:has-content-changed', fileChecksumArgs, (_event, [currentChecksum]) => {
    if (!isFileServiceInitialized()) { return false }
    return getFileService().hasContentChanged(currentChecksum)
  })

  validatedHandle('file:register-initial-checksums', fileRegisterChecksumsArgs, (_event, [objects]) => {
    logger.debug('[IPCManager] file:register-initial-checksums called', { count: objects.length })
    if (!isFileServiceInitialized()) {
      logger.warn('[IPCManager] FileService not initialized')
      return
    }
    getFileService().registerInitialChecksums(new Map(objects))
  })

  validatedHandle('file:update-object-checksum', fileUpdateObjectChecksumArgs, (_event, [runtimeId, data]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().updateObjectChecksum(runtimeId, data)
  })

  validatedHandle('file:remove-object-checksum', fileRemoveObjectChecksumArgs, (_event, [runtimeId]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().removeObjectChecksum(runtimeId)
  })

  ipcMain.handle('file:commit-checksums', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().commitChecksums()
  })

  ipcMain.handle('file:get-dirty-state-details', () => {
    if (!isFileServiceInitialized()) {
      return { isDirty: false, changedIds: [], newIds: [], deletedIds: [] }
    }
    return getFileService().getDirtyStateDetails()
  })
}

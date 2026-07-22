import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import {
  fileOpenArgs, fileSaveArgs, fileSaveAsArgs,
  fileToggleFavoriteArgs, fileRemoveFromRecentArgs,
  fileChecksumArgs, fileShowUnsavedDialogArgs,
  fileHydrateSaveUnitArgs, fileUpsertSaveUnitArgs, fileSaveUnitIdArgs,
  fileSaveUnitToDiskArgs, fileSaveUnitsBatchArgs
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

  ipcMain.handle('file:show-external-change-dialog', async () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return 'reload'
    }
    return getFileService().showExternalChangeDialog()
  })

  ipcMain.handle('file:accept-external-change', () => {
    if (!isFileServiceInitialized()) return false
    getFileService().acceptExternalChange()
    return true
  })

  validatedHandle('file:save', fileSaveArgs, async (_event, [content, options]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().save(content, options?.force === true ? { force: true } : undefined)
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

  ipcMain.handle('file:finish-loading', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().finishLoading()
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

  // ── Save unit v2 API — registry dispatched directly via IPC. ───────
  validatedHandle('file:hydrate-save-unit', fileHydrateSaveUnitArgs, (_event, [params]) => {
    if (!isFileServiceInitialized()) return
    getFileService().getSaveUnitRegistry().hydrate({
      runtimeId: params.runtimeId,
      kind: params.kind,
      reference: params.reference,
      ...(params.parentId !== undefined && { parentId: params.parentId })
    })
  })

  validatedHandle('file:upsert-save-unit', fileUpsertSaveUnitArgs, (_event, [params]) => {
    if (!isFileServiceInitialized()) return
    const registry = getFileService().getSaveUnitRegistry()
    if (!registry.has(params.runtimeId)) {
      registry.create({
        runtimeId: params.runtimeId,
        kind: params.kind,
        draft: params.draft,
        ...(params.parentId !== undefined && { parentId: params.parentId })
      })
      return
    }
    registry.mutate(params.runtimeId, params.draft, params.reason ?? 'modify')
    // A tree move changes WHERE the unit lives, not what it contains — so
    // `mutate` above sees an unchanged document and drops the draft as a
    // revert, leaving the project "saved" while the item sits somewhere
    // else. `move` is what records a relocation (and re-drafts from the
    // reference so it is committable); it no-ops when the parent is
    // unchanged, so passing through it on every upsert is free.
    if (params.parentId !== undefined) {
      registry.move(params.runtimeId, params.parentId)
    }
  })

  validatedHandle('file:mark-save-unit-deleted', fileSaveUnitIdArgs, (_event, [runtimeId]) => {
    if (!isFileServiceInitialized()) return
    const registry = getFileService().getSaveUnitRegistry()
    if (!registry.has(runtimeId)) return
    registry.markDeleted(runtimeId)
  })

  validatedHandle('file:commit-save-unit', fileSaveUnitIdArgs, (_event, [runtimeId]) => {
    if (!isFileServiceInitialized()) return
    getFileService().getSaveUnitRegistry().commit(runtimeId)
  })

  validatedHandle('file:revert-save-unit', fileSaveUnitIdArgs, (_event, [runtimeId]) => {
    if (!isFileServiceInitialized()) return
    getFileService().getSaveUnitRegistry().revert(runtimeId)
  })

  ipcMain.handle('file:get-save-units-snapshot', () => {
    if (!isFileServiceInitialized()) {
      return { isDirty: false, dirtyCount: 0, dirtyUnits: [] }
    }
    return getFileService().getSaveUnitsSnapshot()
  })

  validatedHandle('file:save-unit', fileSaveUnitToDiskArgs, async (_event, [entry]) => {
    if (!isFileServiceInitialized()) return false
    return getFileService().saveUnit(entry)
  })

  validatedHandle('file:save-units-batch', fileSaveUnitsBatchArgs, async (_event, [entries]) => {
    if (!isFileServiceInitialized()) return []
    return getFileService().saveUnitsBatch(entries)
  })
}

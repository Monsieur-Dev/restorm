import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import {
  gitFolderArgs,
  gitSetActiveFolderArgs,
  gitStageArgs,
  gitCommitArgs,
  gitConflictVersionsArgs,
  gitWriteResolvedConflictArgs
} from '../../ipc/schemas'
import { getGitService } from '../../services'

export function registerGitHandlers(): void {
  const service = getGitService()

  validatedHandle('git:is-repo', gitFolderArgs, async (_event, [folder]) => {
    return service.isGitRepo(folder)
  })

  validatedHandle('git:get-status', gitFolderArgs, async (_event, [folder]) => {
    return service.getStatus(folder)
  })

  validatedHandle('git:stage', gitStageArgs, async (_event, [folder, paths]) => {
    await service.stage(folder, paths)
  })

  validatedHandle('git:commit', gitCommitArgs, async (_event, [folder, message, paths]) => {
    return service.commit(folder, message, paths)
  })

  validatedHandle('git:log', gitFolderArgs, async (_event, [folder]) => {
    return service.log(folder)
  })

  validatedHandle('git:push', gitFolderArgs, async (_event, [folder]) => {
    return service.push(folder)
  })

  validatedHandle('git:pull', gitFolderArgs, async (_event, [folder]) => {
    return service.pull(folder)
  })

  validatedHandle('git:fetch-and-compare', gitFolderArgs, async (_event, [folder]) => {
    return service.fetchAndCompare(folder)
  })

  validatedHandle('git:get-conflict-versions', gitConflictVersionsArgs, async (_event, [folder, filePath]) => {
    return service.getConflictVersions(folder, filePath)
  })

  // Same `[folder, filePath]` shape as `getConflictVersions` — reused rather
  // than declaring a duplicate schema.
  validatedHandle('git:get-file-at-head', gitConflictVersionsArgs, async (_event, [folder, filePath]) => {
    return service.getFileAtHead(folder, filePath)
  })

  // Same `[folder, filePath]` shape again — the upstream-ref read that
  // supplies the "theirs" side without starting a merge.
  validatedHandle('git:get-file-at-remote', gitConflictVersionsArgs, async (_event, [folder, filePath]) => {
    return service.getFileAtRemote(folder, filePath)
  })

  // The three-way merge's true common ancestor — HEAD is only the same
  // thing while nothing is committed locally.
  validatedHandle('git:get-file-at-merge-base', gitConflictVersionsArgs, async (_event, [folder, filePath]) => {
    return service.getFileAtMergeBase(folder, filePath)
  })

  validatedHandle('git:get-working-tree-file', gitConflictVersionsArgs, async (_event, [folder, filePath]) => {
    return service.getWorkingTreeFile(folder, filePath)
  })

  validatedHandle('git:reset-to-remote-keeping-working-tree', gitFolderArgs, async (_event, [folder]) => {
    return service.resetToRemoteKeepingWorkingTree(folder)
  })

  validatedHandle('git:reset-hard-to-remote', gitFolderArgs, async (_event, [folder]) => {
    return service.resetHardToRemote(folder)
  })

  validatedHandle('git:write-resolved-conflict', gitWriteResolvedConflictArgs, async (_event, [folder, filePath, content]) => {
    await service.writeResolvedConflict(folder, filePath, content)
  })

  validatedHandle('git:abort-merge', gitFolderArgs, async (_event, [folder]) => {
    await service.abortMerge(folder)
  })

  validatedHandle('git:get-conflict-commit-timestamps', gitFolderArgs, async (_event, [folder]) => {
    return service.getConflictCommitTimestamps(folder)
  })

  validatedHandle('git:set-active-folder', gitSetActiveFolderArgs, async (_event, [folder]) => {
    await service.setActiveFolder(folder)
  })

  ipcMain.handle('git:refresh-state', async () => {
    await service.refreshNow()
  })

  ipcMain.handle('git:get-state', () => {
    return service.getState()
  })
}

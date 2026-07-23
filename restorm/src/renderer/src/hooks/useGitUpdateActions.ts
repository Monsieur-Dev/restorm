/**
 * The three ways an "you are behind the server" situation is actually
 * carried out, once the user (or the absence of any conflict) has
 * decided which one applies. Shared by the Push and the Pull flow so the
 * two can never drift apart.
 *
 * None of them commits. The commit belongs to the publish step alone —
 * a Push commits once, at the very end, and a Pull never does. That is
 * what keeps a cancelled or failed attempt from leaving a commit the
 * user never asked for behind, which is exactly what the previous flow
 * did.
 */

import { useCallback } from 'react'
import type { GitConflictVersions } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { buildMergedProjectYaml } from '../services/mergedProjectYaml'

export interface GitUpdateActionResult {
  success: boolean
  error?: string
}

export interface UseGitUpdateActions {
  /**
   * Move onto the server's latest version while keeping our work.
   *
   * Order matters: the branch pointer is moved FIRST (index and HEAD land
   * on the server's tip, the working tree is left alone), and the merged
   * content is written after — so the file ends up as an ordinary
   * uncommitted modification against the new base, ready to be published.
   * Writing first and resetting after would let the reset's index update
   * race the file we just wrote.
   *
   * `resolvedById` carries the user's per-entity picks when they went
   * through the resolution view; empty means "our side wins whatever is
   * contested", which is both the no-conflict case and the explicit
   * "keep my version" choice.
   */
  updateKeepingMine: (
    gitFolder: string,
    relativePath: string,
    versions: GitConflictVersions,
    resolvedById?: Record<string, FolderItem>
  ) => Promise<GitUpdateActionResult>
  /**
   * Drop every local modification and take the server's version exactly.
   * Destructive — the caller confirms with the user first; nothing here
   * asks. Used both by the modal's "keep the server version" choice and
   * by the Git menu's explicit reset action: one implementation, two
   * entry points.
   */
  takeServerVersion: (gitFolder: string) => Promise<GitUpdateActionResult>
}

export function useGitUpdateActions(): UseGitUpdateActions {
  const updateKeepingMine = useCallback(
    async (
      gitFolder: string,
      relativePath: string,
      versions: GitConflictVersions,
      resolvedById: Record<string, FolderItem> = {}
    ): Promise<GitUpdateActionResult> => {
      // Nothing of ours to preserve → this is a plain fast-forward, and
      // the honest way to perform it is to take the server's bytes as they
      // are. Merging and re-writing would produce a file that is
      // SEMANTICALLY identical to the server's but textually different
      // (our serializer's key order is not the committed one), leaving the
      // project permanently "modified" against HEAD — the user publishes,
      // and the push indicator immediately lights up again for a change
      // they never made.
      //
      // "Nothing of ours" means BOTH: no edit of the file in the working
      // tree, AND no commit of our own that the remote hasn't got. A hard
      // reset discards unpushed commits outright — work the user cannot
      // see in the tree, is never warned about, and only the reflog could
      // recover.
      const status = await window.api.git.getStatus(gitFolder)
      const weHaveLocalChanges = status.files.some((f) => f.path === relativePath) || status.ahead > 0
      if (!weHaveLocalChanges) {
        return window.api.git.resetHardToRemote(gitFolder)
      }

      const moved = await window.api.git.resetToRemoteKeepingWorkingTree(gitFolder)
      if (!moved.success) return moved

      try {
        // Imported documentation resolves by "newest commit wins", so this
        // path needs the timestamps too — without them the rule silently
        // degrades to "ours always wins", and the other side's newer
        // documentation is dropped on every uncontested update.
        const commitTimestamps = await window.api.git.getConflictCommitTimestamps(gitFolder)
        const yamlText = buildMergedProjectYaml(versions, resolvedById, commitTimestamps)
        await window.api.git.writeResolvedConflict(gitFolder, relativePath, yamlText)
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
    []
  )

  const takeServerVersion = useCallback(
    async (gitFolder: string): Promise<GitUpdateActionResult> => {
      return window.api.git.resetHardToRemote(gitFolder)
    },
    []
  )

  return { updateKeepingMine, takeServerVersion }
}

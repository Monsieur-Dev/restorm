/**
 * The pre-flight gate every Push / Pull goes through: is the remote ahead
 * of us, and if so, do our in-progress changes ACTUALLY conflict with it?
 *
 * Why this exists at all. The previous flow committed first and let `git
 * push` fail: the user ended up with a commit they never asked for, a
 * diverged branch, and git's raw English rejection text in a toast — and
 * the conflict-resolution view (the whole point of the feature) was only
 * ever reachable from Pull. The gate answers both questions BEFORE
 * anything is committed or merged, so the user is offered a real choice
 * instead of an error.
 *
 * How it answers them without a merge. The merge-based path
 * (`getConflictVersions`) reads its three sides from the git index's
 * conflict stages, which only exist during an in-progress merge — and
 * git refuses to merge over uncommitted changes, so reaching that state
 * requires committing first. The three sides are sourced read-only here
 * instead:
 *   - base   → the file at the MERGE BASE (`getFileAtMergeBase`), i.e.
 *              the last commit this branch and its upstream share. Not
 *              `HEAD`: once the branch holds a commit of its own, HEAD
 *              already contains our work, so our side would read as
 *              "unchanged" and the merge would revert it to theirs.
 *   - ours   → the working-tree file, i.e. what the caller just saved
 *   - theirs → the file on the upstream ref (`getFileAtRemote`)
 * and handed to the SAME `identifyConflictingEntities` the resolution
 * view is built on. The count the modal announces and the entities the
 * 4-panel view lists can therefore never disagree — they are one
 * computation.
 *
 * "Conflict" stays entity-level, not textual: two people editing two
 * different requests produce zero conflicts here, where a line-based
 * merge of the single project YAML would report several.
 */

import { useCallback } from 'react'
import type { GitConflictVersions } from 'electron-core-ui/renderer'
import { identifyConflictingEntities, type ConflictEntity } from '../../../shared/git/gitConflictModel'
import { processAfterDeserialization } from '../utils/serialization'

export interface GitUpdateGateResult {
  /** Number of commits the upstream is ahead of us. `0` means nothing to
   * update — the caller proceeds straight to its own action. */
  behind: number
  /** The entities that genuinely conflict. Empty with `behind > 0` means
   * the update is a clean fast-forward-with-changes: it still needs the
   * user's decision, but no resolution step will follow. */
  conflicts: ConflictEntity[]
  /** The three sides the verdict was computed from, handed back so the
   * caller can merge without re-reading them. `null` when we are not
   * behind (nothing was read) or the check failed. */
  versions: GitConflictVersions | null
  /** Set when the check itself could not run (offline remote, no
   * upstream, …). The caller treats it as "cannot determine" and lets
   * the underlying git operation report the real error rather than
   * blocking on a check that never completed. */
  error?: string
}

export interface UseGitUpdateGate {
  /** Fetch, then decide whether the caller must show the update modal.
   * Pure read: nothing is committed, merged, reset or written. */
  checkForUpdate: (gitFolder: string, relativePath: string) => Promise<GitUpdateGateResult>
}

export function useGitUpdateGate(): UseGitUpdateGate {
  const checkForUpdate = useCallback(
    async (gitFolder: string, relativePath: string): Promise<GitUpdateGateResult> => {
      const compared = await window.api.git.fetchAndCompare(gitFolder)
      if (compared.error !== undefined) {
        return { behind: 0, conflicts: [], versions: null, error: compared.error }
      }
      if (!compared.remoteHasNewerVersion) {
        return { behind: 0, conflicts: [], versions: null }
      }

      // Only now pay for the three reads — a caller that isn't behind
      // (the common case) never touches the filesystem or git objects.
      const [base, ours, theirs] = await Promise.all([
        window.api.git.getFileAtMergeBase(gitFolder, relativePath),
        window.api.git.getWorkingTreeFile(gitFolder, relativePath),
        window.api.git.getFileAtRemote(gitFolder, relativePath)
      ])

      // `theirs` missing means the upstream doesn't carry this file at
      // all: there is nothing to compare against, so nothing conflicts —
      // the update is a plain fast-forward as far as this file goes.
      if (theirs === null || ours === null) {
        return { behind: compared.behind, conflicts: [], versions: null }
      }

      // HARD GUARD. An empty "ours" is never a legitimate answer while
      // the other sides have content: it means the read failed, not that
      // the user deleted their whole project. Left unchecked it is the
      // most destructive possible input — no entities on our side reads
      // as "nothing of mine conflicts", the prompt never opens, and the
      // merge adopts the server's version wholesale, silently discarding
      // everything the user had. Refuse to judge instead.
      if (ours.trim() === '' && theirs.trim() !== '') {
        return {
          behind: compared.behind,
          conflicts: [],
          versions: null,
          error: 'could not read the working copy of the project file'
        }
      }

      const versions: GitConflictVersions = { path: relativePath, base, ours, theirs }
      const conflicts = identifyConflictingEntities(versions, processAfterDeserialization)
      return { behind: compared.behind, conflicts, versions }
    },
    []
  )

  return { checkForUpdate }
}

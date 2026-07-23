import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService, type GitConflictVersions, type GitConflictCommitTimestamps } from 'electron-core-ui/renderer'
import { useConflictResolution, type UseConflictResolutionResult } from './useConflictResolution'
import type { FolderItem } from '../../../shared/types/folderTypes'
import type { QuickConfig } from '../../../shared/types/requests/QuickConfig'
import type { ConflictEntity } from '../../../shared/git/gitConflictModel'
import { readQuickConfigs } from '../services/conflictFieldDiff'
import { buildMergedProjectYaml, type QuickConfigResolution } from '../services/mergedProjectYaml'

/** `quickConfigs` is an ad-hoc field on the request proxy, not part of the
 * typed `FolderItem` union — name the gap as an explicit optional intersection
 * so the write-back copy stays checked against the rest of `FolderItem`. */
type ItemWithQuickConfigs = FolderItem & { quickConfigs?: QuickConfig[] }

/**
 * Fold the user's per-config quick-config picks into the resolved entity at
 * write-back — the finer-grained counterpart to the whole-entity resolved
 * pick. Only EXPLICITLY-picked configs are overridden (to the chosen side's
 * version); every other config keeps whatever the whole-entity pick already
 * resolved it to, which preserves the safe-floor. Returns a plain copy — this
 * object feeds `buildMergedProjectTree` + serialization, never a reactive
 * panel, so it must NOT mutate the resolved proxy the user may still be
 * editing.
 */
function applyQuickConfigPicks(
  entity: FolderItem,
  conflict: ConflictEntity,
  picks: Record<string, 'ours' | 'theirs'> | undefined
): FolderItem {
  if (!picks || Object.keys(picks).length === 0) return entity
  const oursByName = new Map(readQuickConfigs(conflict.ours).map((c) => [c.name, c]))
  const theirsByName = new Map(readQuickConfigs(conflict.theirs).map((c) => [c.name, c]))
  const next = readQuickConfigs(entity).map((config) => {
    const side = picks[config.name]
    if (!side) return config
    const chosen = (side === 'theirs' ? theirsByName : oursByName).get(config.name)
    return chosen ? structuredClone(chosen) : config
  })
  const copy: ItemWithQuickConfigs = { ...(entity as ItemWithQuickConfigs), quickConfigs: next }
  return copy
}

export interface UseGitPullConflictResult {
  isOpen: boolean
  conflictResolution: UseConflictResolutionResult
  /** Fetch the 3 git stages for the conflicted single file and open the
   * resolution UI. Call this when `window.api.git.pull()` resolves with
   * `conflicted: true`. */
  openFromPull: (folder: string, relativePath: string) => Promise<void>
  /** Open on versions the caller already computed, WITHOUT a git merge in
   * progress. The pre-flight gate reads the three sides read-only, so the
   * resolution view can be reached without ever committing first — the
   * merge-state entry point above is kept for callers that do start a
   * real merge. `publishAfterResolve` tells "finish" whether to publish
   * (Push) or stop at the updated working tree (Pull). */
  openFromVersions: (
    folder: string,
    relativePath: string,
    versions: GitConflictVersions,
    publishAfterResolve: boolean
  ) => void
  close: () => void
  /** Reconstruct the merged project tree from every conflict's resolved
   * pick, write it back (`writeResolvedConflict` — also stages the file),
   * then commit to complete the merge. */
  finishResolution: () => Promise<void>
}

/**
 * The top-level "resolve this pull conflict" flow: opens on a conflicted
 * pull, drives `useConflictResolution` for the UI, and on "finish"
 * reconstructs + writes back + commits the merged single-file project —
 * the write-back half of the conflict-resolution feature (the UI half is
 * `ConflictResolutionView` + `ConflictEntityPanel`).
 */
export interface UseGitPullConflictCallbacks {
  /** Called once the resolved content is on disk, so the app can re-open
   * the project through the normal file-open path: the sidebar tree, the
   * open editor tabs and the search index all have to re-hydrate from the
   * merged file, exactly as a clean pull does. Without it the user keeps
   * looking at their pre-merge tree while the repository has moved on. */
  onProjectReplaced?: () => void
}

export function useGitPullConflict(callbacks: UseGitPullConflictCallbacks = {}): UseGitPullConflictResult {
  const { onProjectReplaced } = callbacks
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [versions, setVersions] = useState<GitConflictVersions | null>(null)
  const [target, setTarget] = useState<{ folder: string, relativePath: string } | null>(null)
  // AC#6's commit-timestamp tie-breaker (used only when an apiDocumentation
  // conflict's version numbers are equal/absent — see
  // `apiDocumentationConflict.ts`). `{ ours: null, theirs: null }` is a
  // harmless default: `resolveApiDocumentationConflict` treats a missing
  // timestamp signal exactly like a tied version, falling back to `ours`.
  const [commitTimestamps, setCommitTimestamps] = useState<GitConflictCommitTimestamps>({ ours: null, theirs: null })
  /** True only when a real `git merge` is underway — the merge-state entry
   * point. Governs whether Cancel must abort anything. */
  const [mergeInProgress, setMergeInProgress] = useState(true)
  /** Push resolves-then-publishes; Pull resolves and stops. */
  const [publishAfterResolve, setPublishAfterResolve] = useState(true)
  const conflictResolution = useConflictResolution(versions)

  const openFromPull = useCallback(async (folder: string, relativePath: string) => {
    const [conflictVersions, timestamps] = await Promise.all([
      window.api.git.getConflictVersions(folder, relativePath),
      window.api.git.getConflictCommitTimestamps(folder)
    ])
    setVersions(conflictVersions)
    setCommitTimestamps(timestamps)
    setTarget({ folder, relativePath })
    setMergeInProgress(true)
    setPublishAfterResolve(true)
    setIsOpen(true)
  }, [])

  // Cancelling out of conflict resolution has no "resume later" path — the
  // repo is left mid-merge (`MERGE_HEAD` + conflict markers in the working
  // tree) with no UI to get back into this screen. Just closing the modal
  // would strand the user there with no visible way to recover short of
  // raw git CLI, so Cancel aborts the merge (`git merge --abort`, which
  // returns to the pre-merge branch tip — the user's own committed work is
  // untouched, only the in-progress merge is undone) before closing.
  const openFromVersions = useCallback((
    folder: string,
    relativePath: string,
    conflictVersions: GitConflictVersions,
    publishAfterResolve: boolean
  ) => {
    setVersions(conflictVersions)
    // No merge is in progress on this path, so there are no merge-commit
    // timestamps to read; the api-documentation tie-breaker falls back to
    // ours exactly as it does for a tie.
    setCommitTimestamps({ ours: null, theirs: null })
    setTarget({ folder, relativePath })
    setMergeInProgress(false)
    setPublishAfterResolve(publishAfterResolve)
    setIsOpen(true)
  }, [])

  // Cancelling out of conflict resolution has no "resume later" path.
  // When we got here through a real git merge, the working tree is left
  // mid-merge and only `git merge --abort` recovers it. When we got here
  // from the pre-flight gate there IS no merge to abort — nothing was
  // written, so closing is genuinely inert.
  const close = useCallback(() => {
    if (target && mergeInProgress) void window.api.git.abortMerge(target.folder)
    setIsOpen(false)
  }, [target, mergeInProgress])

  const finishResolution = useCallback(async () => {
    if (!versions || !target) return

    const resolvedById: Record<string, FolderItem> = {}
    const quickConfigResolutions: QuickConfigResolution[] = []
    for (const conflict of conflictResolution.conflicts) {
      const resolved = conflictResolution.getResolvedEntity(conflict.id)
      // Unreachable through the UI (finishing is gated on every conflict
      // being decided) — but writing back a merge with an undecided entity
      // would silently publish our side of it, so refuse rather than guess.
      if (!resolved) return
      if (conflict.quickConfigName !== undefined) {
        // A saved-configuration entry resolves to a request, but belongs
        // in that request's `quickConfigs` — keyed by the entity id, which
        // this conflict's own id is NOT (it carries the config name too).
        quickConfigResolutions.push({
          requestId: conflict.ours.id,
          configName: conflict.quickConfigName,
          resolved
        })
        continue
      }
      resolvedById[conflict.id] = applyQuickConfigPicks(resolved, conflict, conflictResolution.quickConfigPicks[conflict.id])
    }

    const yamlText = buildMergedProjectYaml(versions, resolvedById, commitTimestamps, quickConfigResolutions)

    // Reached from the pre-flight gate, no merge is underway: move onto
    // the server's tip FIRST so the resolved content lands as an ordinary
    // modification against it (same ordering the silent-update path uses —
    // writing first would let the reset's index update race the write).
    if (!mergeInProgress) {
      const moved = await window.api.git.resetToRemoteKeepingWorkingTree(target.folder)
      if (!moved.success) {
        toasterService.push('app', {
          title: t('gitUpdate.updateFailedTitle'),
          body: moved.error ?? t('gitUpdate.updateFailedBody'),
          durationMs: 10000
        })
        return
      }
    }

    await window.api.git.writeResolvedConflict(target.folder, target.relativePath, yamlText)
    onProjectReplaced?.()

    // Pull resolves and stops: the file is up to date and the user's
    // decisions are on disk, but publishing was never what they asked
    // for — and committing here would reintroduce exactly the stray
    // commit this flow exists to avoid.
    if (!publishAfterResolve) {
      toasterService.push('app', { title: t('git.conflictResolvedTitle'), body: t('git.conflictResolvedBody'), durationMs: 5000 })
      setIsOpen(false)
      return
    }

    const commitResult = await window.api.git.commit(target.folder, t('git.conflictResolvedCommitMessage'), [target.relativePath])
    if (!commitResult.success) {
      toasterService.push('app', {
        title: t('git.pushFailedTitle'),
        body: commitResult.error ?? t('git.pushFailedBody'),
        durationMs: 10000
      })
      return
    }

    // Commit+push is atomic everywhere else in the app (the Push flow) —
    // the merge commit above must not silently strand the repo "ahead",
    // leaving a push pastille the user never asked for after resolving.
    const pushResult = await window.api.git.push(target.folder)
    if (!pushResult.success) {
      toasterService.push('app', {
        title: t('git.pushFailedTitle'),
        body: pushResult.error ?? t('git.pushFailedBody'),
        durationMs: 10000
      })
      return
    }

    toasterService.push('app', { title: t('git.conflictResolvedTitle'), body: t('git.conflictResolvedBody'), durationMs: 5000 })
    setIsOpen(false)
  }, [versions, target, conflictResolution, commitTimestamps, t, mergeInProgress, publishAfterResolve, onProjectReplaced])

  return { isOpen, conflictResolution, openFromPull, openFromVersions, close, finishResolution }
}

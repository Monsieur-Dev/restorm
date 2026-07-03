import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { toasterService, type GitConflictVersions, type GitConflictCommitTimestamps } from 'electron-core-ui/renderer'
import { useConflictResolution, type UseConflictResolutionResult } from './useConflictResolution'
import { parseProjectYaml } from '../../../shared/git/gitCommitDiff'
import { buildMergedProjectTree } from '../../../shared/git/gitConflictMerge'
import { prepareForSerialization, processAfterDeserialization } from '../utils/serialization'

export interface UseGitPullConflictResult {
  isOpen: boolean
  conflictResolution: UseConflictResolutionResult
  /** Fetch the 3 git stages for the conflicted single file and open the
   * resolution UI. Call this when `window.api.git.pull()` resolves with
   * `conflicted: true`. */
  openFromPull: (folder: string, relativePath: string) => Promise<void>
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
export function useGitPullConflict(): UseGitPullConflictResult {
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
  const conflictResolution = useConflictResolution(versions)

  const openFromPull = useCallback(async (folder: string, relativePath: string) => {
    const [conflictVersions, timestamps] = await Promise.all([
      window.api.git.getConflictVersions(folder, relativePath),
      window.api.git.getConflictCommitTimestamps(folder)
    ])
    setVersions(conflictVersions)
    setCommitTimestamps(timestamps)
    setTarget({ folder, relativePath })
    setIsOpen(true)
  }, [])

  // Cancelling out of conflict resolution has no "resume later" path — the
  // repo is left mid-merge (`MERGE_HEAD` + conflict markers in the working
  // tree) with no UI to get back into this screen. Just closing the modal
  // would strand the user there with no visible way to recover short of
  // raw git CLI, so Cancel aborts the merge (`git merge --abort`, which
  // returns to the pre-merge branch tip — the user's own committed work is
  // untouched, only the in-progress merge is undone) before closing.
  const close = useCallback(() => {
    if (target) void window.api.git.abortMerge(target.folder)
    setIsOpen(false)
  }, [target])

  const finishResolution = useCallback(async () => {
    if (!versions || !target) return

    const oursItems = parseProjectYaml(versions.ours, processAfterDeserialization)
    const theirsItems = parseProjectYaml(versions.theirs, processAfterDeserialization)
    const resolvedById: Record<string, ReturnType<typeof conflictResolution.getResolvedEntity>> = {}
    for (const conflict of conflictResolution.conflicts) {
      resolvedById[conflict.id] = conflictResolution.getResolvedEntity(conflict.id)
    }

    const merged = buildMergedProjectTree(oursItems, theirsItems, resolvedById, commitTimestamps)
    // Splice the merged tree into the FULL `ours` document rather than
    // rebuilding `{ collections: merged }` from scratch — `ours` carries
    // top-level project fields beyond `collections` (notably
    // `_projectUuid`, see `shared/config/projectUuid.ts`), and this
    // write-back bypasses `FileService`'s normal save path (which would
    // otherwise re-stamp it via `uuidKey`) entirely — `writeResolvedConflict`
    // is a raw git write. Dropping the uuid here would make the next open
    // regenerate a fresh one, orphaning the DraftStore and changing the
    // project's identity.
    // `versions.ours` is `null` only when the file didn't exist yet at
    // `HEAD` (see `parseProjectYaml`'s own doc) — no document to preserve
    // fields from in that case.
    const oursDocument = versions.ours !== null ? (yamlParse(versions.ours) as Record<string, unknown> | null) : null
    const mergedDocument = { ...(oursDocument ?? {}), collections: merged }
    const yamlText = yamlStringify(prepareForSerialization(mergedDocument))

    await window.api.git.writeResolvedConflict(target.folder, target.relativePath, yamlText)
    const commitResult = await window.api.git.commit(target.folder, t('git.conflictResolvedCommitMessage'))
    if (!commitResult.success) {
      toasterService.push('app', {
        title: t('git.pushFailedTitle'),
        body: commitResult.error ?? t('git.pushFailedBody'),
        durationMs: 10000
      })
      return
    }

    toasterService.push('app', { title: t('git.conflictResolvedTitle'), body: t('git.conflictResolvedBody') })
    setIsOpen(false)
  }, [versions, target, conflictResolution, commitTimestamps, t])

  return { isOpen, conflictResolution, openFromPull, close, finishResolution }
}

import { useCallback, useState } from 'react'
import { i18n as ecuiI18n, renderCommitMessage, toasterService, useSetting, buildSettingsStorageKey } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { useGitFolder } from './useGitFolder'
import { diffProjectEntities, parseProjectYaml, type GitEntityChange } from '../../../shared/git/gitCommitDiff'
import { buildCommitMessageContext } from '../../../shared/git/commitMessageContext'
import { RESTORM_COMMIT_MESSAGE_TEMPLATE } from '../../../shared/git/commitMessageTemplates'
import { processAfterDeserialization } from '../utils/serialization'
import { useGitUpdateGate } from './useGitUpdateGate'
import { useGitUpdateActions } from './useGitUpdateActions'
import type { ConflictEntity } from '../../../shared/git/gitConflictModel'
import type { GitConflictVersions } from 'electron-core-ui/renderer'

// Both keys live in the `git` group declared in `resources/settings.yaml`
// (only `applyCommitMessageLanguageByDefault` has a visible Settings→Git
// row today — `commitMessageLanguage` is Push-modal-only). Computed via
// `buildSettingsStorageKey` rather than hand-written so this can never
// drift from the key `SettingsService` itself resolves for the same
// group/id pair — a hand-rolled key here previously used `.` instead of
// `:`, silently reading/writing a DIFFERENT storage entry than the one
// the Settings UI row used.
const LANGUAGE_SETTING_KEY = buildSettingsStorageKey(['git'], 'commitMessageLanguage')
const APPLY_DEFAULT_SETTING_KEY = buildSettingsStorageKey(['git'], 'applyCommitMessageLanguageByDefault')
const DEFAULT_LANGUAGE = 'en'

export interface PushModalState {
  isOpen: boolean
  /** False when the structural diff against HEAD is empty — the host
   * disables the modal's Push button (nothing to publish). */
  hasChanges: boolean
  language: string
  applyLanguageByDefault: boolean
  title: string
  body: string
  openPushModal: () => void
  closePushModal: () => void
  setLanguage: (code: string) => void
  setApplyLanguageByDefault: (value: boolean) => void
  setTitle: (value: string) => void
  setBody: (value: string) => void
  push: () => void
  /** Set while the server holds a newer version AND the two sides
   * genuinely disagree — the host renders the update modal from it. */
  pendingUpdate: PendingGitUpdate | null
  /** Abandon the update prompt: nothing is committed, merged or reset. */
  cancelPendingUpdate: () => void
  /** Carry out the user's choice on the update prompt. */
  resolvePendingUpdate: (choice: 'keepMine' | 'keepServer' | 'resolve') => void
  /** Raise the prompt from another flow (Pull) — the prompt, and the
   * three ways out of it, are shared. */
  beginUpdatePrompt: (pending: PendingGitUpdate) => void
}

export interface PendingGitUpdate {
  gitFolder: string
  relativePath: string
  versions: GitConflictVersions
  conflicts: ConflictEntity[]
  /** Which click raised the prompt. Only "push" publishes once the
   * update is carried out — a Pull stops at bringing the file up to
   * date, exactly as the user asked. */
  mode: 'push' | 'pull'
}

/**
 * Owns the non-scoped Push modal's full lifecycle: computing the
 * structural diff against the last commit (`window.api.git.getFileAtHead`
 * + `diffProjectEntities`), rendering the commit title/body via ECUI's
 * generic `renderCommitMessage` (regenerated on every language change so
 * both fields auto-update — AC of the Push modal spec), the "apply this
 * language by default" setting sync, and the actual stage → commit →
 * push sequence. `rootItems` is the live in-memory project tree (the
 * "after" side of the diff) — pass whatever `App.tsx` already holds.
 *
 * `saveBeforePush` is awaited immediately before `git.stage` — `git.stage`
 * reads whatever's CURRENTLY ON DISK, which is only as fresh as the last
 * autosave flush (a debounced timer, `files:autoSaveDelay`). Without an
 * explicit save here, a user who edits a field and pushes soon after — a
 * completely normal flow — can silently commit stale, pre-edit content:
 * the diff/generated message above already reflect the in-memory model
 * correctly, but the git operation itself would not. `App.tsx` wires this
 * to its existing `handleMenuSaveAll` (the same function the
 * `file:autosave-trigger` IPC bridge already calls) — no new save
 * mechanism, just calling the existing one at the point that matters.
 */
export interface UsePushModalCallbacks {
  /** Open the 4-panel resolution view on the contested entities. */
  onResolveConflicts?: (pending: PendingGitUpdate) => void
  /** The project file on disk was replaced (updated or reset) — the host
   * reloads the tree and re-indexes so the UI stops showing stale data. */
  onProjectReplaced?: () => void
}

export function usePushModal(
  filePath: string | null,
  rootItems: FolderItem[],
  saveBeforePush: () => Promise<void>,
  callbacks: UsePushModalCallbacks = {}
): PushModalState {
  const { onResolveConflicts, onProjectReplaced } = callbacks
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)
  const { checkForUpdate } = useGitUpdateGate()
  const { updateKeepingMine, takeServerVersion } = useGitUpdateActions()
  const [pendingUpdate, setPendingUpdate] = useState<PendingGitUpdate | null>(null)
  const [applyByDefaultSetting, setApplyByDefaultSetting] = useSetting(APPLY_DEFAULT_SETTING_KEY)
  const [languageSetting, setLanguageSetting] = useSetting(LANGUAGE_SETTING_KEY)

  const applyLanguageByDefault = typeof applyByDefaultSetting === 'boolean' ? applyByDefaultSetting : true
  const defaultLanguage = typeof languageSetting === 'string' && languageSetting !== '' ? languageSetting : DEFAULT_LANGUAGE

  const [isOpen, setIsOpen] = useState(false)
  const [language, setLanguageState] = useState(defaultLanguage)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [changes, setChanges] = useState<GitEntityChange[]>([])

  const regenerate = useCallback((lang: string, entityChanges: GitEntityChange[]) => {
    const fixedT = ecuiI18n.getFixedT(lang)
    const context = buildCommitMessageContext(entityChanges, fixedT)
    const rendered = renderCommitMessage(RESTORM_COMMIT_MESSAGE_TEMPLATE, context)
    setTitle(rendered.title)
    setBody(rendered.body)
  }, [])

  const openPushModal = useCallback(() => {
    // Git integration targets the single-file `.restorm` project model
    // (see `docs/Git/README.md`) — a legacy folder-mode project has no
    // single file to diff/commit here.
    if (!gitFolder || !filePath?.endsWith('.restorm')) return
    const relativePath = filePath.slice(gitFolder.length + 1)
    void window.api.git.getFileAtHead(gitFolder, relativePath).then((rawYaml) => {
      const beforeItems = parseProjectYaml(rawYaml, processAfterDeserialization)
      const entityChanges = diffProjectEntities(beforeItems, rootItems)
      setChanges(entityChanges)
      setLanguageState(defaultLanguage)
      regenerate(defaultLanguage, entityChanges)
      setIsOpen(true)
    })
  }, [gitFolder, filePath, rootItems, defaultLanguage, regenerate])

  const closePushModal = useCallback(() => { setIsOpen(false) }, [])

  const setLanguage = useCallback((code: string) => {
    setLanguageState(code)
    regenerate(code, changes)
    // "Apply this language by default" — the SAME setting the Settings→Git
    // checkbox reads/writes (91.8's future gating wraps both from the
    // outside, unchanged here). When on, every language pick here also
    // becomes tomorrow's default; when off, this pick only affects the
    // commit message being edited right now.
    if (applyLanguageByDefault) {
      void setLanguageSetting(code)
    }
  }, [changes, regenerate, applyLanguageByDefault, setLanguageSetting])

  const setApplyLanguageByDefault = useCallback((value: boolean) => {
    void setApplyByDefaultSetting(value)
  }, [setApplyByDefaultSetting])

  /** Stage + commit + publish. Only ever reached once the working tree
   * is known to be publishable: either we were already up to date, or
   * the update has just been carried out. */
  const commitAndPush = useCallback(async (folder: string, relativePath: string): Promise<void> => {
    const message = body ? `${title}\n\n${body}` : title
    await window.api.git.stage(folder, [relativePath])
    // Scoped to the project file: a commit must never carry whatever the
    // user happens to have staged in a terminal.
    const commitResult = await window.api.git.commit(folder, message, [relativePath])
    if (!commitResult.success) {
      // Close FIRST: the toaster renders under the modal overlay, so an
      // error toast raised while the modal stays open is invisible.
      setIsOpen(false)
      toasterService.push('app', {
        title: t('git.pushFailedTitle'),
        body: commitResult.error ?? t('git.pushFailedBody'),
        durationMs: 10000
      })
      return
    }
    const pushResult = await window.api.git.push(folder)
    if (!pushResult.success) {
      setIsOpen(false)
      toasterService.push('app', {
        title: t('git.pushFailedTitle'),
        body: pushResult.error ?? t('git.pushFailedBody'),
        durationMs: 10000
      })
      return
    }
    toasterService.push('app', { title: t('git.pushSucceededTitle'), body: t('git.pushSucceededBody'), durationMs: 5000 })
    setIsOpen(false)
  }, [title, body, t])

  const push = useCallback(() => {
    if (!gitFolder || !filePath?.endsWith('.restorm')) return
    const relativePath = filePath.slice(gitFolder.length + 1)

    // Flush the live in-memory model to disk FIRST — everything below
    // reads what's on disk, not `rootItems` (see this hook's own doc).
    void saveBeforePush().then(async () => {
      const gate = await checkForUpdate(gitFolder, relativePath)

      // Up to date (or the check itself couldn't run — then let the real
      // git operation report the real error rather than guessing here).
      if (gate.behind === 0 || gate.versions === null) {
        await commitAndPush(gitFolder, relativePath)
        return
      }

      // Behind, but nothing is contested: there is no decision for the
      // user to make. Merge their work in and carry on publishing —
      // asking would be ceremony for its own sake.
      if (gate.conflicts.length === 0) {
        const updated = await updateKeepingMine(gitFolder, relativePath, gate.versions)
        if (!updated.success) {
          setIsOpen(false)
          toasterService.push('app', {
            title: t('gitUpdate.updateFailedTitle'),
            body: updated.error ?? t('gitUpdate.updateFailedBody'),
            durationMs: 10000
          })
          return
        }
        toasterService.push('app', { title: t('gitUpdate.updatedTitle'), body: t('gitUpdate.updatedBody'), durationMs: 5000 })
        // The file on disk now carries the other side's work too — reload
        // it, or the user keeps looking at the pre-merge tree while their
        // colleague's changes sit invisibly in the file they just pushed.
        onProjectReplaced?.()
        await commitAndPush(gitFolder, relativePath)
        return
      }

      // Genuinely contested — hand the decision over. Nothing has been
      // committed, merged or reset at this point, so cancelling here
      // truly leaves the repository untouched.
      setIsOpen(false)
      setPendingUpdate({ gitFolder, relativePath, versions: gate.versions, conflicts: gate.conflicts, mode: 'push' })
    })
  }, [gitFolder, filePath, t, saveBeforePush, checkForUpdate, updateKeepingMine, commitAndPush, onProjectReplaced])

  const cancelPendingUpdate = useCallback(() => {
    // Deliberately inert: no commit was ever made, so there is nothing to
    // undo. That is the whole point of gating BEFORE committing.
    setPendingUpdate(null)
  }, [])

  const resolvePendingUpdate = useCallback((choice: 'keepMine' | 'keepServer' | 'resolve') => {
    const pending = pendingUpdate
    if (!pending) return
    setPendingUpdate(null)

    if (choice === 'resolve') {
      // The 4-panel view takes over from here; it already owns its own
      // write-back + publish. Handing it the versions we computed keeps
      // both sides on one merge.
      onResolveConflicts?.(pending)
      return
    }

    void (async () => {
      if (choice === 'keepServer') {
        const taken = await takeServerVersion(pending.gitFolder)
        if (!taken.success) {
          toasterService.push('app', {
            title: t('gitUpdate.updateFailedTitle'),
            body: taken.error ?? t('gitUpdate.updateFailedBody'),
            durationMs: 10000
          })
          return
        }
        toasterService.push('app', { title: t('gitUpdate.discardedTitle'), body: t('gitUpdate.discardedBody'), durationMs: 5000 })
        onProjectReplaced?.()
        return
      }

      // keepMine — our side wins every contested entity, their
      // uncontested work still merges in, then we publish.
      const updated = await updateKeepingMine(pending.gitFolder, pending.relativePath, pending.versions)
      if (!updated.success) {
        toasterService.push('app', {
          title: t('gitUpdate.updateFailedTitle'),
          body: updated.error ?? t('gitUpdate.updateFailedBody'),
          durationMs: 10000
        })
        return
      }
      onProjectReplaced?.()
      // A Pull stops here: the file is up to date and the user's work is
      // intact but unpublished, which is precisely what Pull means.
      if (pending.mode === 'push') {
        await commitAndPush(pending.gitFolder, pending.relativePath)
      }
    })()
  }, [pendingUpdate, t, takeServerVersion, updateKeepingMine, commitAndPush, onResolveConflicts, onProjectReplaced])

  return {
    isOpen,
    hasChanges: changes.length > 0,
    language,
    applyLanguageByDefault,
    title,
    body,
    openPushModal,
    closePushModal,
    setLanguage,
    setApplyLanguageByDefault,
    setTitle,
    setBody,
    push,
    beginUpdatePrompt: setPendingUpdate,
    pendingUpdate,
    cancelPendingUpdate,
    resolvePendingUpdate
  }
}

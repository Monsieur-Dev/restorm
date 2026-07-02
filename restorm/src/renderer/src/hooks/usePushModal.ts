import { useCallback, useState } from 'react'
import { i18n as ecuiI18n, renderCommitMessage, toasterService, useSetting, buildSettingsStorageKey } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { useGitFolder } from './useGitFolder'
import { diffProjectEntities, parseProjectYaml, type GitEntityChange } from '../../../shared/git/gitCommitDiff'
import { buildCommitMessageContext } from '../../../shared/git/commitMessageContext'
import { RESTORM_COMMIT_MESSAGE_TEMPLATE } from '../../../shared/git/commitMessageTemplates'
import { processAfterDeserialization } from '../utils/serialization'

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
 */
export function usePushModal(filePath: string | null, rootItems: FolderItem[]): PushModalState {
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)
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

  const push = useCallback(() => {
    if (!gitFolder || !filePath?.endsWith('.restorm')) return
    const relativePath = filePath.slice(gitFolder.length + 1)
    const message = body ? `${title}\n\n${body}` : title
    void window.api.git.stage(gitFolder, [relativePath])
      .then(() => window.api.git.commit(gitFolder, message))
      .then((commitResult) => {
        if (!commitResult.success) {
          toasterService.push('app', {
            title: t('git.pushFailedTitle'),
            body: commitResult.error ?? t('git.pushFailedBody'),
            durationMs: 10000
          })
          return
        }
        return window.api.git.push(gitFolder).then((pushResult) => {
          if (!pushResult.success) {
            toasterService.push('app', {
              title: t('git.pushFailedTitle'),
              body: pushResult.error ?? t('git.pushFailedBody'),
              durationMs: 10000
            })
            return
          }
          toasterService.push('app', { title: t('git.pushSucceededTitle'), body: t('git.pushSucceededBody') })
          setIsOpen(false)
        })
      })
  }, [gitFolder, filePath, title, body, t])

  return {
    isOpen,
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
    push
  }
}

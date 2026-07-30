/**
 * Tells the user that a file was deliberately NOT reopened.
 *
 * The crash-loop protection is invisible when it works: the app simply starts
 * empty. But an empty app is exactly what losing someone's work looks like, so
 * the silence is the problem — a protection nobody is told about reads as a
 * bug. Naming the file and the reason turns "did Restorm lose my project?" into
 * "Restorm noticed that file crashes it and left it closed."
 *
 * Headless, like the consent prompt: it renders nothing and drives the app
 * toaster instead.
 *
 * It reads AND subscribes, because neither alone is enough. The withhold
 * decision is taken several seconds after the window loads — later than this
 * component's first render — so the push is what normally delivers it; the read
 * is for a renderer that reloaded afterwards and missed the push.
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from 'electron-core-ui/renderer'
import type { CrashRecoveryNotice as CrashRecoveryNoticeState } from '../../../../shared/crash/crashTypes'

/** Stable id: a re-push replaces the toast rather than stacking a second one. */
const TOAST_ID = 'restorm:crash-recovery-notice'

/**
 * The slice of the bridge this needs — narrowed AND fully optional.
 *
 * `window.api` is DECLARED as always carrying every member, but the declaration
 * describes the preload we BUILD, not necessarily the one that LOADED. Making
 * each member optional turns the checks below into real questions rather than
 * ones the type system has already answered on the strength of an assumption.
 */
interface RecoveryNoticeBridge {
  getRecoveryNotice?: () => Promise<CrashRecoveryNoticeState>
  onRecoveryNotice?: (callback: (notice: CrashRecoveryNoticeState) => void) => (() => void)
}

/** The file's own name — the part the user recognises. A full path in a toast
 * is noise, and the directory tells them nothing they don't know. */
function fileNameOf(path: string | null): string | null {
  if (path === null || path === '') return null
  const name = path.split(/[\\/]/).pop()
  return name === undefined || name === '' ? null : name
}

export const CrashRecoveryNotice: React.FC = () => {
  const { t } = useTranslation()
  // Shown at most once per launch: the withhold is a single startup fact, and
  // a re-push on every state echo would nag about something already read.
  const shownRef = useRef(false)

  useEffect(() => {
    // Missing bridge ⇒ no toast, never a throw. See `RecoveryNoticeBridge`.
    const api = (window.api as Partial<Window['api']> | undefined)?.crash as
      RecoveryNoticeBridge | undefined
    const subscribe = api?.onRecoveryNotice
    if (subscribe === undefined) return

    const apply = (notice: CrashRecoveryNoticeState): void => {
      if (!notice.fileWithheld || shownRef.current) return
      shownRef.current = true
      const name = fileNameOf(notice.withheldPath)
      toasterService.push('app', {
        id: TOAST_ID,
        title: t('crashRecovery.notice.title'),
        body: name === null
          ? t('crashRecovery.notice.bodyUnnamed')
          : t('crashRecovery.notice.body', { file: name })
      })
    }

    // Subscribe BEFORE reading, so a notice landing between the two is not lost.
    const unsubscribe = subscribe(apply)
    api?.getRecoveryNotice?.().then(apply).catch(() => {
      // Nothing to recover from here: the push covers the normal case, and a
      // failed read must not be able to break the app it is reassuring about.
    })
    return unsubscribe
  }, [t])

  return null
}

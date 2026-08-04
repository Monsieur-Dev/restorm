import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from '../components/Toaster/ToasterService'
import type { SaveFailureReason } from '../../errors'

/**
 * One toast, reused. The notice describes a STATE — "the last save
 * failed" — so there is at most one of it at any time, and it is the same
 * one whether the failure came from Ctrl+S or from the autosave tick that
 * followed it.
 */
const TOAST_ID = 'file-save-failed'

/**
 * Translation key per cause. Written out rather than derived from the
 * reason string so the compiler flags a new {@link SaveFailureReason}
 * that nobody wrote a message for — a missing key silently renders the
 * key itself to the user.
 */
const REASON_KEY: Record<SaveFailureReason, string> = {
  'read-only-file': 'file.saveFailed.reason.readOnlyFile',
  'read-only-location': 'file.saveFailed.reason.readOnlyLocation',
  'permission-denied': 'file.saveFailed.reason.permissionDenied',
  'disk-full': 'file.saveFailed.reason.diskFull',
  'quota-exceeded': 'file.saveFailed.reason.quotaExceeded',
  'path-missing': 'file.saveFailed.reason.pathMissing',
  'file-busy': 'file.saveFailed.reason.fileBusy',
  unknown: 'file.saveFailed.reason.unknown'
}

/**
 * Surface a failed write to disk in the `app` toaster, and retract it
 * once a save gets through. Mount once at the app root.
 *
 * A failed save is otherwise invisible: the dirty markers stay lit, which
 * looks exactly like "not saved yet" — so the user keeps working on a
 * file they believe is on disk and finds out on close. The markers are
 * deliberately left alone here; this hook only adds the missing words.
 *
 * The toast tracks a state rather than an event, which is what makes it
 * survivable next to an autosave that retries every few seconds:
 *
 * 1. a failure with no notice showing → push one, naming the cause;
 * 2. a failure while it is still showing → nothing at all (an ordinary
 *    notification queue would stack one per attempt);
 * 3. a failure after the user dismissed it → push a fresh one, because
 *    they have been told nothing since;
 * 4. a save that succeeds → dismiss it, since the state it describes is
 *    over.
 *
 * It carries no auto-dismiss on purpose: a timeout would retract a
 * warning that is still true.
 *
 * Requires the host preload to expose `window.api.file` and an `app`
 * toaster (`<Toaster id="app" />`) mounted somewhere in the tree.
 */
export function useSaveFailureToast(): void {
  const { t } = useTranslation()
  useEffect(() => {
    const api = window.api.file
    const unsubscribeFailed = api.onFileSaveFailed(({ path, reason, detail }) => {
      // An exiting toast is on its way out and can no longer be read, so
      // it does not count as "the user has been told".
      const alreadyShowing = toasterService
        .getToasts('app')
        .some((toast) => toast.id === TOAST_ID && !toast.exiting)
      if (alreadyShowing) return
      toasterService.push('app', {
        id: TOAST_ID,
        title: t('file.saveFailed.title'),
        body: (
          <div data-testid="save-failed-toast-body">
            <div>{t(REASON_KEY[reason], { error: detail })}</div>
            {path !== null && <div>{path}</div>}
          </div>
        ),
        // Losing work is worth interrupting a screen reader for.
        ariaLive: 'assertive'
      })
    })
    const unsubscribeSucceeded = api.onFileSaveSucceeded(() => {
      toasterService.dismiss('app', TOAST_ID)
    })
    return () => {
      unsubscribeFailed()
      unsubscribeSucceeded()
    }
  }, [t])
}

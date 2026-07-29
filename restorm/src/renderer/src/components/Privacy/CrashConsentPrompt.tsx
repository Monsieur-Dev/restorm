/**
 * Shows the crash-reporting consent prompt while the user still owes an answer.
 *
 * Headless — it renders nothing and drives the app toaster instead, the same
 * shape as the "what's new" notification.
 *
 * It holds NO policy of its own. Whether to ask is one boolean pushed from the
 * main process, which derives it from the same consent rule that decides whether
 * to arm the reporter. In particular this component does not look at the account
 * plan: a Community account's gate is plan-mandated rather than unanswered, so
 * `shouldPrompt` is already false for them, and re-checking the plan here would
 * put the "who gets asked" rule in two places.
 *
 * That also gives the re-prompt on promotion for free. When an account gains a
 * paid plan the mandate lifts, its gate reverts to unanswered, and the main
 * process pushes `shouldPrompt: true` — no plan diffing, no baseline to get
 * wrong, and no risk of mistaking the signed-out state every session starts in
 * for a downgrade.
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from 'electron-core-ui/renderer'
import type { CrashConsentState } from '../../../../shared/crash/crashTypes'
import { CrashConsentToastBody } from './CrashConsentToastBody'

/** Stable id: re-pushing replaces the prompt in place instead of stacking. */
const TOAST_ID = 'restorm:crash-consent'

export const CrashConsentPrompt: React.FC = () => {
  const { t } = useTranslation()
  // What the toast currently shows. Re-pushing with an unchanged answer would
  // reset the toast's timer and its internal checkbox, wiping out a choice the
  // user has made but not yet saved.
  const shownRef = useRef(false)

  useEffect(() => {
    // Widened deliberately: `window.api` is DECLARED as always carrying the
    // bridge, but the declaration describes the preload we build, not
    // necessarily the one that loaded. Missing bridge ⇒ no prompt, never a throw.
    const api = (window.api as Partial<Window['api']> | undefined)?.crash
    if (api === undefined) return

    const dismiss = (): void => {
      if (!shownRef.current) return
      shownRef.current = false
      toasterService.dismiss('app', TOAST_ID)
    }

    const apply = (state: CrashConsentState): void => {
      if (!state.shouldPrompt) { dismiss(); return }
      if (shownRef.current) return
      shownRef.current = true
      toasterService.push('app', {
        id: TOAST_ID,
        title: t('privacy.consentToast.title'),
        // No auto-dismiss: a consent prompt that expires on its own would count
        // silence as an answer, and silence is exactly what must NOT be recorded.
        durationMs: undefined,
        body: (
          <CrashConsentToastBody
            initialGranted={state.granted}
            onSave={(granted) => {
              // Fire-and-forget: the main process records the answer and pushes
              // the new consent state back, which dismisses the toast through
              // the same path as any other change. Nothing here has to guess.
              void window.api.crash.setConsent(granted)
            }}
          />
        )
      })
    }

    // Subscribe before reading, so a change landing during the read is not lost.
    const unsubscribe = api.onConsentStateChanged(apply)
    void api.getConsentState().then(apply).catch(() => {
      // A prompt we cannot decide to show is simply not shown. Failing to ask is
      // recoverable on the next launch; nothing is sent while unanswered.
    })
    return () => { unsubscribe() }
  }, [t])

  return null
}

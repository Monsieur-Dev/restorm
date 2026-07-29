/**
 * Shows the "what will be sent" dialog when the main process holds a report.
 *
 * The main process asks and waits; this answers. One report is on screen at a
 * time — the main process already refuses to ask a second question while one is
 * open, and this keeps a single slot so the two cannot disagree.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CrashReviewRequest } from '../../../../shared/crash/crashTypes'
import { CRASH_REVIEW_SETTING_KEY } from '../../../../shared/config/observability'
import { CrashReportDialog } from './CrashReportDialog'

export const CrashReportReviewHost: React.FC = () => {
  const [request, setRequest] = useState<CrashReviewRequest | null>(null)

  useEffect(() => {
    // Widened deliberately: the declaration describes the preload we build, not
    // necessarily the one that loaded.
    const api = (window.api as Partial<Window['api']> | undefined)?.crash
    if (api === undefined) return
    // A window that closes under a pending question is resolved main-side (the
    // report is discarded), and that window's renderer is gone with it — so
    // there is no live case where main must withdraw a dialog still on screen.
    return api.onReviewRequested((next) => { setRequest(next) })
  }, [])

  const handleResolve = useCallback((send: boolean, waiveReview: boolean): void => {
    const current = request
    setRequest(null)
    if (current === null) return
    window.api.crash.resolveReview(current.id, send)
    if (waiveReview) {
      // Persisted rather than held in memory: the waiver has to outlive this
      // dialog, and it has to be visible (and undoable) in the privacy settings
      // — a "stop asking me" that could only be reversed by crashing again
      // would be a trap rather than a preference.
      void window.api.settings.set(CRASH_REVIEW_SETTING_KEY, false)
    }
  }, [request])

  if (request === null) return null
  return <CrashReportDialog request={request} onResolve={handleResolve} />
}

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, MarkdownViewer, toasterService } from 'electron-core-ui/renderer'
import { useUpdateState } from '../hooks/useUpdateState'
import type { UpdatePhase } from '../../../shared/update/updateTypes'

const UPDATE_READY_TOAST_ID = 'restorm:update-ready'
const WHATS_NEW_TOAST_ID = 'restorm:whats-new'

/**
 * Global, headless component (renders nothing) that turns auto-update state
 * transitions into app-toaster notifications, and shows a "What's new" note the
 * first time the app runs after an update. Mount once, near the app root.
 */
export function UpdateNotifications(): null {
  const { t } = useTranslation()
  const { state, quitAndInstall } = useUpdateState()
  const prevPhaseRef = useRef<UpdatePhase | null>(null)
  const whatsNewShownRef = useRef(false)

  // Transition-driven toasts.
  useEffect(() => {
    if (!state) return
    const prev = prevPhaseRef.current
    prevPhaseRef.current = state.phase
    if (state.phase === prev) return // e.g. a download-progress tick — same phase

    if (state.phase === 'downloaded') {
      toasterService.push('app', {
        id: UPDATE_READY_TOAST_ID,
        title: t('updates.readyTitle'),
        durationMs: undefined,
        body: (
          <div className="update-ready-toast">
            <p>{t('updates.readyBody', { version: state.version ?? '' })}</p>
            <Button
              appearance="rainbow"
              onClick={() => {
                void quitAndInstall()
              }}
            >
              {t('updates.restartNow')}
            </Button>
          </div>
        )
      })
    } else if (state.phase === 'error' && state.error?.trigger === 'manual') {
      toasterService.push('app', {
        title: t('updates.checkFailedTitle'),
        body: t('updates.checkFailedBody'),
        durationMs: 5000
      })
    } else if (prev === 'checking' && state.phase === 'idle' && state.trigger === 'manual') {
      toasterService.push('app', {
        title: t('updates.upToDateTitle'),
        body: t('updates.upToDateBody', { version: state.currentVersion }),
        durationMs: 3000
      })
    }
  }, [state, t, quitAndInstall])

  // "What's new" once, the first run after an update. The ref guard keeps it to
  // a single run even though `t` is (correctly) a dependency.
  useEffect(() => {
    if (whatsNewShownRef.current) return
    whatsNewShownRef.current = true
    const api = window.api.update
    void (async () => {
      const [settings, lastSeen] = await Promise.all([
        api.getSettings(),
        api.getLastSeenVersion()
      ])
      const current = settings.currentVersion
      if (!lastSeen || lastSeen === current) return
      const md = await api.getChangelogSince(lastSeen)
      if (md.trim().length > 0) {
        toasterService.push('app', {
          id: WHATS_NEW_TOAST_ID,
          title: t('updates.whatsNewTitle', { version: current }),
          durationMs: undefined,
          body: <MarkdownViewer compact value={md} />
        })
      }
      await api.markVersionSeen(current)
    })()
  }, [t])

  return null
}

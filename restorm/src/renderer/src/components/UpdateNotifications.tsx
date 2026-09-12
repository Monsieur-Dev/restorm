import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  MarkdownViewer,
  ReleaseNotesModal,
  ScrollableElement,
  eventBus,
  logger,
  toasterService
} from 'electron-core-ui/renderer'
import { useUpdateState } from '../hooks/useUpdateState'
import { countSectionsNewerThan } from '../../../shared/update/releaseNotes'
import type { ReleaseNoteSection, UpdatePhase } from '../../../shared/update/updateTypes'
import {
  RELEASE_NOTES_OPEN,
  type ReleaseNotesMode,
  type ReleaseNotesOpenPayload
} from './releaseNotesEvents'
import './updateNotifications.css'

const UPDATE_READY_TOAST_ID = 'restorm:update-ready'
const WHATS_NEW_TOAST_ID = 'restorm:whats-new'

/** How many recent versions the modal reveals up front when the previously
 * installed version is unknown (post-update toast + Help menu). */
const RECENT_COUNT = 10

/**
 * Global, headless-ish component that turns auto-update state transitions into
 * app-toaster notifications, shows a "What's new" note the first run after an
 * update, and owns the on-demand release-notes modal (opened from the update
 * toasts and the Help menu). Mount once, near the app root.
 */
export function UpdateNotifications(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { state, quitAndInstall } = useUpdateState()
  const prevPhaseRef = useRef<UpdatePhase | null>(null)
  const whatsNewShownRef = useRef(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sections, setSections] = useState<ReleaseNoteSection[]>([])
  const [initialCount, setInitialCount] = useState<number>(RECENT_COUNT)

  // Only the most recent open may write the result. The notes come off the
  // network, so a second click while the first fetch is in flight would
  // otherwise let whichever request happens to resolve last win — and that one
  // may carry the other mode's reveal count.
  const openSeqRef = useRef(0)

  // Open the modal, THEN fetch: the notes are fetched from the release feed, so
  // waiting for them before opening leaves the link looking dead for as long as
  // the feed takes. `sinceCurrent` reveals the versions newer than the running
  // one up front (rest behind "show more"); `recent` reveals the N most recent
  // (previous version unknown).
  const openReleaseNotes = useCallback(
    async (mode: ReleaseNotesMode): Promise<void> => {
      const api = window.api.update
      const seq = ++openSeqRef.current
      setSections([])
      setLoading(true)
      setModalOpen(true)
      try {
        const secs = await api.getReleaseNotes(i18n.language)
        let initial: number
        if (mode === 'sinceCurrent') {
          const current = state?.currentVersion ?? (await api.getSettings()).currentVersion
          // At least one section (the target) shows; the modal clamps a 0 up to 1.
          initial = countSectionsNewerThan(secs, current)
        } else {
          initial = Math.min(RECENT_COUNT, secs.length)
        }
        if (seq !== openSeqRef.current) return
        setSections(secs)
        setInitialCount(initial)
      } finally {
        // A superseded open must not clear the newer one's spinner.
        if (seq === openSeqRef.current) setLoading(false)
      }
    },
    [i18n.language, state?.currentVersion]
  )

  // Keep a stable ref to the latest opener so toast bodies (pushed once, but
  // long-lived) and the eventBus subscription never call a stale closure. Both
  // read it on a user interaction, long after this effect has run.
  const openerRef = useRef<((mode: ReleaseNotesMode) => void) | null>(null)
  useEffect(() => {
    openerRef.current = (mode: ReleaseNotesMode): void => {
      // The modal is already open by then and settles into its empty state, so
      // a rejected IPC only needs logging — not an unhandled rejection.
      openReleaseNotes(mode).catch((err: unknown) => {
        logger.warn('Failed to load release notes', { error: String(err) })
      })
    }
  })

  // Open on request from elsewhere in the renderer (the Help-menu entry).
  useEffect(() => {
    const sub = eventBus.subscribe<ReleaseNotesOpenPayload>(RELEASE_NOTES_OPEN, (payload) => {
      openerRef.current?.(payload.mode)
    })
    return () => { sub.unsubscribe() }
  }, [])

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
            <Button
              link
              onClick={() => { openerRef.current?.('sinceCurrent') }}
            >
              {t('updates.seeReleaseNotes')}
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
      const md = await api.getChangelogSince(lastSeen, i18n.language)
      if (md.trim().length > 0) {
        toasterService.push('app', {
          id: WHATS_NEW_TOAST_ID,
          title: t('updates.whatsNewTitle'),
          durationMs: undefined,
          body: (
            <div className="whats-new-toast">
              <ScrollableElement
                className="whats-new-toast__note"
                // The cap has to travel via `style`, not CSS: with `fitContent`
                // the scrollable copies `style.maxHeight` onto the element that
                // actually scrolls. Capping it from a stylesheet instead leaves
                // that element uncapped, so it grows to its full content height
                // and the wheel has nothing to scroll.
                style={{ maxHeight: 'min(40vh, 220px)' }}
                options={{ vertical: 'auto', horizontal: 'hidden', fitContent: true }}
              >
                <MarkdownViewer compact value={md} />
              </ScrollableElement>
              <Button
                link
                onClick={() => { openerRef.current?.('recent') }}
              >
                {t('updates.seeReleaseNotes')}
              </Button>
            </div>
          )
        })
      }
      await api.markVersionSeen(current)
    })()
  }, [t, i18n])

  return (
    <ReleaseNotesModal
      isOpen={modalOpen}
      onClose={() => { setModalOpen(false) }}
      sections={sections}
      initialCount={initialCount}
      loading={loading}
      title={t('menuBar.releaseNotes')}
    />
  )
}

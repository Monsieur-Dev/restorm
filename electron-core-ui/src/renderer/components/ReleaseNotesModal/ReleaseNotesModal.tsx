import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../Modal'
import { MarkdownViewer } from '../MarkdownViewer/MarkdownViewer'
import { ScrollableElement } from '../ScrollableElement'
import { Button } from '../Button'
import './releaseNotesModal.css'

/** One release's notes: a version label + its markdown body. */
export interface ReleaseNoteSection {
  /** Human-readable version label (e.g. `1.2.0`). Used as the React key and in
   * the per-section test id — must be unique within `sections`. */
  version: string
  /** The release note markdown for this version. Rendered with images restricted
   * to self-contained inline `data:` URIs — images and media the renderer would
   * have to fetch are dropped rather than displayed, so release notes issue no
   * outbound image/media request. This component performs no fetching of its
   * own. */
  markdown: string
}

export interface ReleaseNotesModalProps {
  /** When false, the modal is not rendered. */
  isOpen: boolean
  /** Requested close (Esc / the modal's close button). */
  onClose: () => void
  /**
   * The release sections, ordered newest → oldest. The modal shows the first
   * `initialCount` of them and reveals the rest one at a time (oldest-ward) via
   * the "show more" button at the bottom.
   */
  sections: ReleaseNoteSection[]
  /**
   * How many sections are visible initially. Defaults to all of them. Clamped to
   * `[1, sections.length]` (at least one section shows whenever there is any, so
   * the modal never opens blank with only a "show more" button). The remaining
   * older sections are revealed one per "show more" click.
   */
  initialCount?: number
  /** Modal title. Defaults to the localized "What's new". */
  title?: React.ReactNode
  /** Label of the reveal-more button. Defaults to the localized "Show more". */
  revealMoreLabel?: React.ReactNode
  /**
   * The sections are still being resolved (fetched, read from disk, …). Shows a
   * placeholder instead of the "nothing to show" empty state, so a consumer that
   * opens the modal before its data arrives — the right thing to do when
   * fetching, otherwise the trigger looks dead — does not flash "no release
   * notes" on the way. Ignored once `sections` is non-empty.
   */
  loading?: boolean
  /** Body shown while `loading`. Defaults to a localized placeholder. */
  loadingLabel?: React.ReactNode
  /** Body shown when `sections` is empty. Defaults to a localized placeholder. */
  emptyLabel?: React.ReactNode
  /** Test id applied to the modal root. Defaults to `release-notes-modal`. */
  'data-testid'?: string
}

/**
 * Generic release-notes / changelog viewer: a modal that renders an ordered list
 * of `{ version, markdown }` sections (newest first) and progressively reveals
 * the older ones one at a time. The mechanism is app-agnostic — the consumer
 * supplies the data (already localized) and decides how many sections are "new"
 * via `initialCount`; this component owns the layout, the reveal interaction,
 * and the guarantee that rendering the notes fetches no image or media (images
 * must be inline `data:` URIs; anything remote is dropped).
 */
export const ReleaseNotesModal: React.FC<ReleaseNotesModalProps> = ({
  isOpen,
  onClose,
  sections,
  initialCount,
  title,
  revealMoreLabel,
  loading = false,
  loadingLabel,
  emptyLabel,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const rootTestId = dataTestId ?? 'release-notes-modal'

  const total = sections.length
  const clampedInitial = useMemo(() => {
    const requested = initialCount ?? total
    if (total === 0) return 0
    return Math.min(Math.max(requested, 1), total)
  }, [initialCount, total])

  const [revealedCount, setRevealedCount] = useState(clampedInitial)

  // Re-seed the reveal count whenever the modal (re)opens or its inputs change,
  // so a second open never inherits a previous session's expanded state. Done by
  // adjusting state during render (React's recommended alternative to a
  // setState-in-effect): track the last (open, initial) we seeded for and reset
  // the moment it differs. Closing updates the marker too, so reopening with an
  // unchanged initial count still re-seeds.
  const seedKey = isOpen ? `open:${clampedInitial}` : 'closed'
  const [seededFor, setSeededFor] = useState(seedKey)
  if (seedKey !== seededFor) {
    setSeededFor(seedKey)
    if (isOpen) setRevealedCount(clampedInitial)
  }

  const visible = sections.slice(0, revealedCount)
  const hasMore = revealedCount < total

  return (
    <Modal
      title={title ?? t('releaseNotesModal.title', "What's new")}
      isOpen={isOpen}
      onClose={onClose}
      data-testid={rootTestId}
    >
      <ScrollableElement
        className="ecu-release-notes-scroll"
        options={{ vertical: 'auto', horizontal: 'hidden' }}
        data-testid={`${rootTestId}-scroll`}
      >
        <div className="ecu-release-notes-body">
          {total === 0 && loading ? (
            <div className="ecu-release-notes-placeholder" data-testid={`${rootTestId}-loading`}>
              {loadingLabel ?? t('releaseNotesModal.loading', 'Loading release notes…')}
            </div>
          ) : total === 0 ? (
            <div className="ecu-release-notes-placeholder" data-testid={`${rootTestId}-empty`}>
              {emptyLabel ?? t('releaseNotesModal.empty', 'No release notes to show.')}
            </div>
          ) : (
            <>
              {visible.map((section) => (
                <section
                  key={section.version}
                  className="ecu-release-notes-section"
                  data-version={section.version}
                  data-testid={`${rootTestId}-section-${section.version}`}
                >
                  <MarkdownViewer
                    value={section.markdown}
                    inlineImagesOnly
                    data-testid={`${rootTestId}-md-${section.version}`}
                  />
                </section>
              ))}
              {hasMore && (
                <div className="ecu-release-notes-more">
                  <Button
                    secondary
                    onClick={() => { setRevealedCount((n) => Math.min(n + 1, total)) }}
                    data-testid={`${rootTestId}-show-more`}
                  >
                    {revealMoreLabel ?? t('releaseNotesModal.showMore', 'Show more')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollableElement>
    </Modal>
  )
}

export default ReleaseNotesModal

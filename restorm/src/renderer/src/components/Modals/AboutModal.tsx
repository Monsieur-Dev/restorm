/**
 * The Help → About dialog: brand mark, product name + running version,
 * tagline, site links, publisher block and the legal mentions.
 *
 * The mark is the FULL-COLOUR artwork shipped in the app's `assets/imgs`
 * public dir, not the `BrandIcon` font glyph: that glyph inherits
 * `currentColor` and is monochrome by construction, so it cannot render the
 * yellow bolt + white R on their dark plate.
 *
 * Links open in the user's default browser. The main process installs a
 * `setWindowOpenHandler` that routes an http(s) `window.open` through
 * `shell.openExternal`, so pre-empting the anchor's default navigation with
 * `window.open` is all that is needed — same path the documentation host uses.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Modal, Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { resolveChannel } from '../../../../shared/config/backend'
import { docsUrl, releaseNotesUrl, websiteUrl } from '../../../../shared/config/site'
import './AboutModal.css'

export interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

/** Publisher name — a proper noun, identical in every locale. */
const PUBLISHER_NAME = 'Monsieur Dev'

/** Product name — a proper noun; the ® rides it as a superscript. */
const PRODUCT_NAME = 'Restorm'

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)

  // The version never changes for the window's lifetime; fetch it once.
  useEffect(() => {
    let cancelled = false
    void window.api.app.getVersion().then((v) => {
      if (!cancelled) setVersion(v)
    })
    return () => { cancelled = true }
  }, [])

  // Preview builds link to the dev site, releases to restorm.app — resolved
  // off the same `-preview` version suffix the statusbar shows.
  const channel = resolveChannel(version ?? '')
  const locale = i18n.language

  const openExternal = useCallback((event: React.MouseEvent<HTMLAnchorElement>): void => {
    // Cancel the anchor's own navigation FIRST, before deciding whether the
    // target is safe to hand to the browser. Validating first and returning
    // early on a reject would let the default navigation proceed — the
    // renderer would leave the app and become a web page, which is precisely
    // what the scheme check exists to prevent.
    event.preventDefault()
    const href = event.currentTarget.getAttribute('href')
    if (href === null || !/^https?:\/\//i.test(href)) return
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [])

  return (
    <Modal
      title={t('menuBar.about')}
      isOpen={isOpen}
      onClose={onClose}
      size="dialog"
      dialogWidth={470}
      data-testid="about-modal"
    >
      <div className="about-modal">
        <div className="about-modal__main">
          <img
            className="about-modal__mark"
            src="/imgs/logo.png"
            alt=""
            data-testid="about-modal-mark"
          />
          <div className="about-modal__identity">
            <div className="about-modal__name" data-testid="about-modal-name">
              {PRODUCT_NAME}
              <sup className="about-modal__registered">®</sup>
            </div>
            <div className="about-modal__version" data-testid="about-modal-version">
              {version === null ? '' : t('about.version', { version })}
            </div>
            <div className="about-modal__tagline">{t('about.tagline')}</div>
            <div className="about-modal__links">
              <a
                href={websiteUrl(channel, locale)}
                onClick={openExternal}
                data-testid="about-modal-link-website"
              >
                {t('about.links.website')}
              </a>
              <a
                href={docsUrl(channel, locale)}
                onClick={openExternal}
                data-testid="about-modal-link-docs"
              >
                {t('about.links.documentation')}
              </a>
              <a
                href={releaseNotesUrl(channel, locale)}
                onClick={openExternal}
                data-testid="about-modal-link-release-notes"
              >
                {t('about.links.releaseNotes')}
              </a>
            </div>
          </div>

          <div className="about-modal__rule" />

          <div className="about-modal__publisher">
            {/* The publisher mark is bicolour — a blue block plus a dark shape.
             * Laid straight on the app's dark chrome the dark half disappears
             * and the logo is unreadable at this size, so it sits on a light
             * chip that keeps both halves visible on every theme. */}
            <span className="about-modal__publisher-chip">
              <img
                src="/imgs/monsieurdev-logo.svg"
                alt=""
                data-testid="about-modal-publisher-logo"
              />
            </span>
            <div>
              <div className="about-modal__publisher-label">{t('about.publishedBy')}</div>
              <div className="about-modal__publisher-name" data-testid="about-modal-publisher">
                {PUBLISHER_NAME}
              </div>
            </div>
          </div>

          <div className="about-modal__legal">
            <div>{t('about.legal.trademark')}</div>
            <div>{t('about.legal.copyright')}</div>
          </div>
        </div>

        <div className="about-modal__footer">
          <Button onClick={onClose} data-testid="about-modal-close-button">
            {t('about.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

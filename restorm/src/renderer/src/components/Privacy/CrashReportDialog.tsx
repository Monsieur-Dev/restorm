/**
 * "Here is exactly what would be sent."
 *
 * Layered on purpose. The summary names the CATEGORIES in the report and what
 * has been removed from it, which is what someone deciding whether to send
 * actually needs. The expandable section holds the real payload, byte for byte,
 * for anyone who wants to check rather than trust. Neither alone is enough: a
 * summary alone would make "exactly what is sent" a paraphrase, and a raw JSON
 * dump alone would put a stack trace in front of someone who just wanted to
 * know whether their API tokens were in it.
 *
 * The payload is the genuine scrubbed event for THIS crash, captured after the
 * scrubbing gate passed — never a representative sample. That is the only
 * version of this dialog that makes the consent promise true.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, ScrollableElement, Toggle } from 'electron-core-ui/renderer'
import type { CrashReviewRequest } from '../../../../shared/crash/crashTypes'
import './crashReportDialog.css'

export interface CrashReportDialogProps {
  request: CrashReviewRequest
  /** `send` false ⇒ discard. `waiveReview` true ⇒ stop asking in future. */
  onResolve: (send: boolean, waiveReview: boolean) => void
}

export const CrashReportDialog: React.FC<CrashReportDialogProps> = ({ request, onResolve }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [waive, setWaive] = useState(false)

  const toggleExpanded = (): void => { setExpanded((open) => !open) }

  return (
    <Modal
      title={t('privacy.reportDialog.title')}
      isOpen
      // Closing without choosing is not consent. The modal's own close paths
      // (Escape, the header button) resolve as "don't send", the same as the
      // explicit refusal — silence never sends.
      onClose={() => { onResolve(false, false) }}
      size="dialog"
      dialogWidth={640}
      data-testid="crash-report-dialog"
    >
      <div className="crash-report-dialog">
        <p className="crash-report-dialog-intro">{t('privacy.reportDialog.intro')}</p>

        <ul className="crash-report-dialog-included">
          <li>{t('privacy.reportDialog.includedError')}</li>
          <li>{t('privacy.reportDialog.includedVersion')}</li>
          <li>{t('privacy.reportDialog.includedActivity')}</li>
        </ul>

        <p className="crash-report-dialog-removed">{t('privacy.reportDialog.removed')}</p>

        {/* ECUI has no disclosure primitive, so this follows the same
          * keyboard/ARIA contract as the other hand-rolled sections in the app
          * rather than inventing a new one. */}
        <div
          className="crash-report-dialog-expander"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          data-testid="crash-report-dialog-expander"
          onClick={toggleExpanded}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleExpanded()
            }
          }}
        >
          <i className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} aria-hidden="true" />
          <span>{t('privacy.reportDialog.viewFull')}</span>
        </div>

        {expanded && (
          <ScrollableElement
            options={{ horizontal: 'auto', vertical: 'auto' }}
            style={{ maxHeight: '32vh' }}
            data-testid="crash-report-dialog-payload"
          >
            {/* Deliberately a plain <pre>: a code editor would pull a heavy
              * dependency into the one dialog that only appears when the app has
              * already broken. */}
            <pre className="crash-report-dialog-payload">{request.payload}</pre>
          </ScrollableElement>
        )}

        <Toggle
          checked={waive}
          onChange={(next) => { setWaive(next) }}
          data-testid="crash-report-dialog-waive"
        >
          {t('privacy.reportDialog.waive')}
        </Toggle>

        <div className="crash-report-dialog-actions">
          <Button
            secondary
            data-testid="crash-report-dialog-discard"
            onClick={() => { onResolve(false, waive) }}
          >
            {t('privacy.reportDialog.discard')}
          </Button>
          <Button
            data-testid="crash-report-dialog-send"
            onClick={() => { onResolve(true, waive) }}
          >
            {t('privacy.reportDialog.send')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

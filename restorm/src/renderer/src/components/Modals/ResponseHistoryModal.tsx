import React, { useEffect } from 'react'
import type { ResponseHistoryDetail } from '../../../../shared/types/collections'
import { ResponseHistoryTab } from '../RequestTabViews/ResponseHistoryTab'
import { useTranslation } from 'react-i18next'
import { TabContainedOverlay } from '../MainView/TabContainedOverlay'
import './responseHistoryModal.css'

export interface ResponseHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  requestId: string
  refreshKey?: number | undefined
  buildResponseView: (detail: ResponseHistoryDetail) => {
    infosContent?: React.ReactNode | undefined
    responseContent?: React.ReactNode | undefined
    jsonData?: unknown
  }
}

/**
 * Response-history viewer, rendered as an overlay **scoped to the
 * request tab** rather than the whole window — an `absolute` backdrop
 * against the tab's relative wrapper (`.restorm-workbench-tab`), so the
 * sidebar + other tabs stay interactive. Mirrors the scenario `input`
 * prompt's inline-overlay approach (no ECUI `Modal`, whose portal
 * target is the document body / full window).
 */
export const ResponseHistoryModal: React.FC<ResponseHistoryModalProps> = ({
  isOpen,
  onClose,
  requestId,
  refreshKey,
  buildResponseView
}) => {
  const { t } = useTranslation()

  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [isOpen, onClose])

  return (
    <TabContainedOverlay>
      {isOpen ? (
    <div
      className="response-history-overlay-backdrop"
      data-testid="response-history-modal"
      onMouseDown={onClose}
    >
      <div className="response-history-overlay-panel" onMouseDown={(e) => { e.stopPropagation() }}>
        <header
          className="response-history-overlay-header"
          onMouseDown={(e) => {
            // Middle-click on the header closes the overlay — mirrors the
            // ECUI Modal titlebar behaviour.
            if (e.button === 1) { e.preventDefault(); onClose() }
          }}
        >
          <span className="response-history-overlay-title">{t('requestTab.tabs.responsesHistory')}</span>
          <button
            type="button"
            className="response-history-overlay-close"
            onClick={onClose}
            aria-label={t('common.close', 'Close')}
            title={t('common.close', 'Close')}
            data-testid="response-history-close"
          >
            <span className="codicon codicon-close" />
          </button>
        </header>
        <div className="response-history-overlay-body">
          <ResponseHistoryTab
            requestId={requestId}
            refreshKey={refreshKey}
            buildResponseView={buildResponseView}
          />
        </div>
      </div>
    </div>
      ) : null}
    </TabContainedOverlay>
  )
}

export default ResponseHistoryModal

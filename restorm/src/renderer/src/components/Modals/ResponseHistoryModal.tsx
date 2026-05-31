import React from 'react'
import type { ResponseHistoryDetail } from '../../../../shared/types/collections'
import { ResponseHistoryTab } from '../RequestTabViews/ResponseHistoryTab'
import { useTranslation } from 'react-i18next'
import { Modal } from 'electron-core-ui/renderer'
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
 * Response-history viewer, rendered as an ECUI `Modal` scoped to the request
 * tab (`scopeToSelector=".restorm-workbench-tab"`) rather than the whole
 * window — so the sidebar + other tabs stay interactive. The Modal supplies
 * the backdrop, header (title + close), Escape / middle-click handling.
 */
export const ResponseHistoryModal: React.FC<ResponseHistoryModalProps> = ({
  isOpen,
  onClose,
  requestId,
  refreshKey,
  buildResponseView
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('requestTab.tabs.responsesHistory')}
      isOpen={isOpen}
      onClose={onClose}
      scopeToSelector=".restorm-workbench-tab"
      data-testid="response-history-modal"
    >
      <div className="response-history-overlay-body">
        <ResponseHistoryTab
          requestId={requestId}
          refreshKey={refreshKey}
          buildResponseView={buildResponseView}
        />
      </div>
    </Modal>
  )
}

export default ResponseHistoryModal

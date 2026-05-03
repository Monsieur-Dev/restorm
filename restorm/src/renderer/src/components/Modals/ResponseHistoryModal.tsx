import React from 'react'
import { Modal } from 'electron-core-ui/renderer'
import type { ResponseHistoryDetail } from '../../../../shared/types/collections'
import { ResponseHistoryTab } from '../RequestTabViews/ResponseHistoryTab'
import { useTranslation } from 'react-i18next'

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
      isOpen={isOpen}
      onClose={onClose}
      title={t('requestTab.tabs.responsesHistory')}
      data-testid="response-history-modal"
    >
      <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
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

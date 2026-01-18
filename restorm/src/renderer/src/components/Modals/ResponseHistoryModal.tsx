import React from 'react'
import { Modal } from 'electron-core-ui/renderer'
import type { ResponseHistoryDetail } from '../../types/collections'
import { ResponseHistoryTab } from '../RequestTabViews/ResponseHistoryTab'
import { useTranslation } from 'react-i18next'

export interface ResponseHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  requestId: string
  requestPath?: string
  refreshKey?: number
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
  requestPath,
  refreshKey,
  buildResponseView
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('requestTab.tabs.responsesHistory')}
    >
      <div style={{ height: '70vh', minHeight: 420, width: '80vw', minWidth: 720 }}>
        <ResponseHistoryTab
          requestId={requestId}
          requestPath={requestPath}
          refreshKey={refreshKey}
          buildResponseView={buildResponseView}
        />
      </div>
    </Modal>
  )
}

export default ResponseHistoryModal

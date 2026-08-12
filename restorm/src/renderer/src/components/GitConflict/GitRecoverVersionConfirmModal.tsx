import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from 'electron-core-ui/renderer'

export interface GitRecoverVersionConfirmModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  'data-testid'?: string
}

/**
 * Confirmation for "recover this version" from the git-history view. Unlike
 * "reset to server", this doesn't rewind the branch — it overwrites the open
 * file's working-tree content with a past commit's, leaving it uncommitted.
 * The confirmation exists because it can discard the user's current unsaved
 * edits to that file; the wording says what happens (the current content is
 * replaced) rather than a bare "are you sure?".
 */
export const GitRecoverVersionConfirmModal: React.FC<GitRecoverVersionConfirmModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  'data-testid': dataTestId = 'git-recover-version-confirm'
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('gitHistory.recoverConfirmTitle')}
      isOpen={isOpen}
      onClose={onCancel}
      size="dialog"
      dialogWidth={520}
      data-testid={dataTestId}
      enterActionTestId={`${dataTestId}-confirm-button`}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, lineHeight: 1.5 }} data-testid={`${dataTestId}-message`}>
          {t('gitHistory.recoverConfirmBody')}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onCancel} data-testid={`${dataTestId}-cancel-button`}>
            {t('gitUpdate.cancel')}
          </Button>
          <Button onClick={onConfirm} data-testid={`${dataTestId}-confirm-button`}>
            {t('gitHistory.recoverConfirmAction')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

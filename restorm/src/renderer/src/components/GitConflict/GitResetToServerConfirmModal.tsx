import React from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from 'electron-core-ui/renderer'

export interface GitResetToServerConfirmModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  'data-testid'?: string
}

/**
 * Confirmation for "reset to the server version" — the one action in the
 * git surface that destroys work outright.
 *
 * It exists as its own component rather than reusing the delete
 * confirmation: that one is phrased around a named item ("delete the
 * folder X?"), while this discards an unbounded amount of unpublished
 * work with nothing to name. The wording has to carry that weight on its
 * own, which is why the body spells out what is lost rather than asking a
 * bare "are you sure?".
 */
export const GitResetToServerConfirmModal: React.FC<GitResetToServerConfirmModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  'data-testid': dataTestId = 'git-reset-to-server-confirm'
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('gitUpdate.resetConfirmTitle')}
      isOpen={isOpen}
      onClose={onCancel}
      size="dialog"
      dialogWidth={520}
      data-testid={dataTestId}
      enterActionTestId={`${dataTestId}-confirm-button`}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, lineHeight: 1.5 }} data-testid={`${dataTestId}-message`}>
          {t('gitUpdate.resetConfirmBody')}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onCancel} data-testid={`${dataTestId}-cancel-button`}>
            {t('gitUpdate.cancel')}
          </Button>
          <Button onClick={onConfirm} data-testid={`${dataTestId}-confirm-button`}>
            {t('gitUpdate.keepServerVersion')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
